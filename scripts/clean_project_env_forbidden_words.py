"""One-off maintainer script: strip banned exam-essay phrases from stored
project_env legacy texts (README item 4, 软考项目环境体验优化).

The prompt-layer ban (合同金额/团队规模/团队人数, prompts/project_env/*.jinja)
only constrains newly generated content, so environments produced before the
ban can still carry the phrases in their main fields, mock drafts
(draft_content) and verified snapshots (verified_snapshot — the chat
injection source). This script removes every offending sentence via the
deterministic, idempotent cleaner in open_notebook/domain/project_env_cleaner.py.

DEFAULT IS DRY-RUN: without --apply it only prints the per-field diff and
never writes to the database.

Usage (run from the repo root, SurrealDB up, .env present):

    # 1) Preview — zero writes. This is the only mode allowed inside the
    #    delivery workflow; the maintainer runs it first and reviews the diff.
    uv run python scripts/clean_project_env_forbidden_words.py

    # 2) After human review of the diff: back up the original records to a
    #    local JSON file, then clean + save through the ORM (env.save(), the
    #    API's own write path — status untouched, no LLM verification
    #    triggered, no PUT involved).
    uv run python scripts/clean_project_env_forbidden_words.py --apply

A "无需清理" dry-run (0 hits across every record and container) is a normal
outcome, not a malfunction: the stored data already complies with the ban,
there is no diff to review, and --apply must not be run — with nothing dirty
the script exits before writing, so an --apply would be a harmless no-op.

The --apply run first dumps every project_env record exactly as SELECTed
(full original values of all fields, including draft_content and
verified_snapshot) to project_env_backup_<timestamp>.json (override with
--backup-file) so the pre-clean state stays auditable and restorable by hand.
"""

# Load environment variables (SURREAL_*) before the DB-touching imports,
# same pattern as api/main.py.
from dotenv import load_dotenv

load_dotenv()

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from open_notebook.domain.project_env import ProjectEnv
from open_notebook.domain.project_env_cleaner import (
    FORBIDDEN_PHRASES,
    apply_env_cleaning,
    plan_env_cleaning,
    removed_sentences,
)

Plan = Dict[str, Dict[str, Dict[str, str]]]


def _print_diff(env: ProjectEnv, plan: Plan) -> None:
    print(f"[{env.id}] {env.name} (status={env.status})")
    for container, fields in plan.items():
        for field, change in fields.items():
            print(f"  {container}.{field}:")
            for sentence in removed_sentences(change["before"]):
                print(f"    - 删除: {sentence.strip()}")
            print(f"    = 清洗后: {change['after'] or '(空)'}")


def _backup_payload(envs: List[ProjectEnv]) -> Dict[str, Any]:
    return {
        "note": "project_env pre-clean backup (original values as SELECTed)",
        "forbidden_phrases": list(FORBIDDEN_PHRASES),
        "taken_at": datetime.now().isoformat(),
        "records": [env.model_dump(mode="json") for env in envs],
    }


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Remove banned phrases (合同金额/团队规模/团队人数) from "
        "stored project_env legacy texts. DRY-RUN unless --apply is given."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="back up the original records to JSON, then clean and save "
        "(default: dry-run, print the diff only)",
    )
    parser.add_argument(
        "--backup-file",
        default=None,
        help="backup JSON path used with --apply "
        "(default: project_env_backup_<timestamp>.json in the cwd)",
    )
    args = parser.parse_args()

    envs: List[ProjectEnv] = await ProjectEnv.get_all()
    planned: List[Tuple[ProjectEnv, Plan]] = [
        (env, plan_env_cleaning(env)) for env in envs
    ]
    dirty = [(env, plan) for env, plan in planned if plan]
    total_fields = sum(
        sum(len(fields) for fields in plan.values()) for _, plan in dirty
    )

    print(f"共 {len(envs)} 个项目环境，禁词命中待清理字段 {total_fields} 处。")
    for env, plan in dirty:
        _print_diff(env, plan)

    if not args.apply:
        if dirty:
            print("DRY-RUN：以上变更未写库。人工核对后加 --apply 执行。")
        else:
            print("无需清理：未发现任何禁词残留。")
        return 0

    if not dirty:
        print("无需清理：未发现任何禁词残留，未写库。")
        return 0

    # Backup the original values BEFORE the first write.
    backup_file = args.backup_file or (
        f"project_env_backup_{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    )
    Path(backup_file).write_text(
        json.dumps(_backup_payload(envs), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"已备份原始记录到 {backup_file}")

    cleaned = 0
    for env, _plan in dirty:
        changed = apply_env_cleaning(env)
        if changed:
            await env.save()
            cleaned += changed
            print(f"[{env.id}] 已清洗 {changed} 个字段并保存。")
    print(f"完成：清洗 {cleaned} 个字段，涉及 {len(dirty)} 个环境。")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(asyncio.run(main()))
