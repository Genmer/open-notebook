"""Shared service for project environments: prompt injection gate and
session binding validation (软考项目环境).

Injection gate matrix (the ONLY source is env.verified_snapshot):
- verified                  -> snapshot text
- pending + old snapshot    -> snapshot text prefixed with a stale-version note
- pending, no snapshot      -> not injectable
- needs_review / failed     -> not injectable
- dangling id (env deleted) -> state "dangling" signal, not injectable
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException
from loguru import logger

from open_notebook.domain.project_env import ProjectEnv
from open_notebook.exceptions import NotFoundError

INJECTABLE_STATUS_NOTE = "（以下为最近一次通过验证的版本）"


async def render_project_env_context(env_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Resolve a session's project_env reference into injectable prompt text.

    Returns {"text": str | None, "state": str}; text is None whenever the gate
    is closed. Never raises for missing/deleted envs (dangling signal)."""
    if not env_id:
        return None
    try:
        env = await ProjectEnv.get(env_id)
    except Exception as e:  # dangling ref degrades; chat must not break
        logger.warning(f"Project env {env_id} unavailable at injection time: {e}")
        return {"text": None, "state": "dangling"}

    if env.status == "verified" and env.verified_snapshot:
        return {"text": _render_snapshot(env.verified_snapshot), "state": "verified"}

    if env.status == "pending" and env.verified_snapshot:
        text = f"{INJECTABLE_STATUS_NOTE}\n{_render_snapshot(env.verified_snapshot)}"
        return {"text": text, "state": "pending_stale"}

    return {"text": None, "state": env.status}


async def resolve_project_env_context(env_ref: Optional[str]) -> Optional[str]:
    """Convenience wrapper for the chat chains: injectable text or None."""
    if not env_ref:
        return None
    result = await render_project_env_context(env_ref)
    return result["text"] if result else None


def _render_snapshot(snapshot: Dict[str, Any]) -> str:
    source_type = snapshot.get("source_type", "")
    lines: list[str] = []
    labels = {
        "name": "项目名称",
        "period_start": "项目起始时间",
        "period_end": "项目结束时间",
        "background": "项目背景",
        "tech_background": "技术背景",
        "tuning_process": "调优过程",
        "problems_solutions": "问题与解决方案",
        "my_role": "本人角色",
        "scale": "项目规模",
    }
    for key, label in labels.items():
        value = snapshot.get(key)
        if isinstance(value, str) and value.strip():
            lines.append(f"{label}：{value.strip()}")
    if source_type:
        lines.append(
            f"素材来源：{'真实项目' if source_type == 'real' else 'AI 模拟项目'}"
        )
    frozen_at = snapshot.get("frozen_at")
    if frozen_at:
        lines.append(f"验证通过时间：{frozen_at}")
    return "\n".join(lines)


async def require_verified_project_env(env_id: str) -> ProjectEnv:
    """Session binding gate: only verified envs may be bound (decision ⑤)."""
    try:
        env = await ProjectEnv.get(env_id)
    except NotFoundError:
        raise HTTPException(
            status_code=422,
            detail={"message": f"Project env {env_id} not found", "env_status": None},
        )
    if env.status != "verified":
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Project env is not verified; only verified project "
                "environments can be bound to a session",
                "env_id": str(env.id),
                "env_status": env.status,
            },
        )
    return env
