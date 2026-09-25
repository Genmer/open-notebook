"""AI source classification commands: cluster embeddings or group titles into
named groups under a source view, via a single (or batched) LLM call."""

import math
import os
import re
import time
import uuid
from typing import Any, Dict, List, Literal, Optional, Set, Tuple

import numpy as np
from ai_prompter import Prompter
from langchain_core.exceptions import OutputParserException
from langchain_core.output_parsers.pydantic import PydanticOutputParser
from loguru import logger
from pydantic import BaseModel, Field, ValidationError
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.exceptions import ConfigurationError
from open_notebook.utils.clustering import dominant_dimension, kmeans, pool_embeddings
from open_notebook.utils.text_utils import clean_thinking_content, extract_text_content

CLASSIFY_RETRY_CONFIG = {
    "max_attempts": 3,
    "wait_strategy": "exponential_jitter",
    "wait_min": 5,
    "wait_max": 60,
    "stop_on": [
        ValueError,
        ConfigurationError,
    ],  # Permanent failures (bad LLM output, no model configured): no retry
    "retry_log_level": "warning",
}

_MAX_REPRESENTATIVE_TITLES = 8
_MERGE_CENTROID_COSINE = 0.90
_TITLE_BATCH_SIZE = 200
_MAX_GROUP_NAME = 100

_STAGES = {
    "clustering": (5, "Clustering source content"),
    "llm": (30, "AI is naming groups"),
    "assigning": (80, "Writing groups"),
}


class ClassifySourcesInput(CommandInput):
    view_id: str
    method: Literal["content", "title"]


class ClassifySourcesOutput(CommandOutput):
    success: bool
    groups_created: int = 0
    sources_classified: int = 0
    unclassified: int = 0
    processing_time: float
    error_message: Optional[str] = None


class ClusterAssignment(BaseModel):
    name: str
    cluster_ids: List[str] = Field(default_factory=list)
    extra_source_ids: List[str] = Field(default_factory=list)


class ClassificationPlan(BaseModel):
    groups: List[ClusterAssignment] = Field(default_factory=list)


def _display_title(row: Dict[str, Any]) -> str:
    title = (row.get("title") or "").strip()
    if title:
        return title
    file_path = ((row.get("asset") or {}).get("file_path") or "").strip()
    return os.path.basename(file_path) if file_path else ""


def _clean_group_name(name: str) -> str:
    return " ".join((name or "").split())[:_MAX_GROUP_NAME]


async def _set_progress(
    view_id: str, stage: str, percent: int, message: str = "", error: Optional[str] = None
) -> None:
    try:
        await repo_query(
            "UPDATE $view_id SET classify_progress = $progress",
            {
                "view_id": ensure_record_id(view_id),
                "progress": {
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                    "error": error,
                },
            },
        )
    except Exception as e:
        # Progress is cosmetic; a failed write must not kill the classification.
        logger.warning(f"Failed to update classify_progress for {view_id}: {e}")


async def _llm_classification_plan(
    prompt_template: str, data: Dict[str, Any], view_id: str
) -> ClassificationPlan:
    parser: PydanticOutputParser[ClassificationPlan] = PydanticOutputParser(
        pydantic_object=ClassificationPlan
    )
    system_prompt = Prompter(prompt_template=prompt_template, parser=parser).render(  # type: ignore[arg-type]
        data=data
    )
    prov = await provision_langchain_model_with_info(
        system_prompt, None, "chat", max_tokens=8192
    )
    try:
        ai_message = await prov.langchain_model.ainvoke(system_prompt)
        content = clean_thinking_content(extract_text_content(ai_message.content))
        plan = parser.parse(content)
        await record_llm_usage(
            model=prov, ai_message=ai_message, call_type="classification", correlation_id=view_id
        )
        return plan
    except Exception as e:
        await record_llm_usage(
            model=prov,
            ai_message=None,
            call_type="classification",
            correlation_id=view_id,
            success=False,
            error=str(e),
        )
        raise


async def _plan_with_retry(
    prompt_template: str, data: Dict[str, Any], view_id: str
) -> ClassificationPlan:
    try:
        return await _llm_classification_plan(prompt_template, data, view_id)
    except (OutputParserException, ValidationError):
        # One feedback round with the parser error, then give up permanently.
        logger.warning(f"First classification attempt failed for view {view_id}, retrying with error feedback")
        return await _llm_classification_plan(
            prompt_template,
            {**data, "previous_error": "The previous output could not be parsed as the requested JSON."},
            view_id,
        )


def _kmeans_clusters(
    pooled: Dict[str, np.ndarray],
    main_pool: List[str],
    titles: Dict[str, str],
    view_id: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, List[str]], List[List[str]]]:
    """Cluster the main pool; returns LLM-facing cluster summaries, the
    cluster_id -> member source ids map, and centroid merge suggestions."""
    matrix = np.array([pooled[sid] for sid in main_pool], dtype=np.float64)
    k = max(3, min(16, int(math.sqrt(len(main_pool)))))
    labels = kmeans(matrix, k)

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    normalized = matrix / np.where(norms == 0, 1.0, norms)
    k_actual = int(labels.max()) + 1 if len(labels) else 0

    clusters: List[Dict[str, Any]] = []
    cluster_members: Dict[str, List[str]] = {}
    centroids: List[np.ndarray] = []
    for cluster in range(k_actual):
        member_idx = np.where(labels == cluster)[0]
        if len(member_idx) == 0:
            continue
        centroid = normalized[member_idx].mean(axis=0)
        norm = np.linalg.norm(centroid)
        if norm:
            centroid = centroid / norm
        centroids.append(centroid)
        cid = str(cluster)
        cluster_members[cid] = [main_pool[i] for i in member_idx]
        ranked = sorted(member_idx.tolist(), key=lambda i: -float(normalized[i] @ centroid))
        clusters.append(
            {
                "cluster_id": cid,
                "representative_titles": [
                    titles.get(main_pool[i]) or "(untitled)"
                    for i in ranked[:_MAX_REPRESENTATIVE_TITLES]
                ],
            }
        )

    suggested: List[List[str]] = []
    for a in range(len(centroids)):
        for b in range(a + 1, len(centroids)):
            if float(centroids[a] @ centroids[b]) > _MERGE_CENTROID_COSINE:
                suggested.append([str(a), str(b)])

    logger.info(
        f"[classify:{view_id}] kmeans produced {len(clusters)} clusters over "
        f"{len(main_pool)} sources, {len(suggested)} suggested merges"
    )
    return clusters, cluster_members, suggested


async def _load_sources() -> List[Dict[str, Any]]:
    return await repo_query("SELECT id, title, asset FROM source") or []


async def _classify_content(
    view_id: str,
) -> Tuple[ClassificationPlan, Dict[str, List[str]], Set[str], int]:
    """Pipeline A: cluster pooled embeddings, then let the LLM name/merge/drop clusters.

    Returns (plan, cluster_members, valid_source_ids, unclassifiable_source_count)."""
    await _set_progress(view_id, "clustering", *_STAGES["clustering"])
    source_rows = await _load_sources()
    embedding_rows = (
        await repo_query(
            "SELECT source, embedding FROM source_embedding WHERE array::len(embedding) > 0"
        )
        or []
    )

    all_ids = [str(row["id"]) for row in source_rows]
    titles = {str(row["id"]): _display_title(row) for row in source_rows}
    pooled = pool_embeddings(
        [(str(row["source"]), row["embedding"]) for row in embedding_rows]
    )

    # Sources whose embedding provider changed dimensions join the fallback pool.
    dim = dominant_dimension(list(pooled.values()))
    main_pool = [sid for sid in all_ids if sid in pooled and len(pooled[sid]) == dim]

    clusters: List[Dict[str, Any]] = []
    cluster_members: Dict[str, List[str]] = {}
    suggested_merges: List[List[str]] = []
    if len(main_pool) >= 3:
        clusters, cluster_members, suggested_merges = _kmeans_clusters(
            pooled, main_pool, titles, view_id
        )
        leftover_ids = [sid for sid in all_ids if sid not in set(main_pool)]
    else:
        # Zero or too few embeddings: everything goes through title-based grouping.
        leftover_ids = all_ids

    data = {
        "clusters": clusters,
        "suggested_merges": suggested_merges,
        "leftover_sources": [
            {"source_id": sid, "title": titles.get(sid) or "(untitled)"}
            for sid in leftover_ids
        ],
    }
    await _set_progress(view_id, "llm", *_STAGES["llm"])
    plan = await _plan_with_retry("classify/cluster_naming", data, view_id)
    return plan, cluster_members, set(all_ids), 0


async def _classify_title(
    view_id: str,
) -> Tuple[ClassificationPlan, Set[str], int]:
    """Pipeline B: batch-classify source titles, reusing group names across batches.

    Returns (plan, valid_source_ids, untitled_count)."""
    await _set_progress(view_id, "clustering", *_STAGES["clustering"])
    source_rows = await _load_sources()

    items = []
    untitled = 0
    for row in source_rows:
        title = _display_title(row)
        if not title:
            untitled += 1
            continue
        items.append({"source_id": str(row["id"]), "title": title})

    by_name: Dict[str, ClusterAssignment] = {}
    batches = [
        items[i : i + _TITLE_BATCH_SIZE] for i in range(0, len(items), _TITLE_BATCH_SIZE)
    ]
    for index, batch in enumerate(batches):
        percent = 30 + int(50 * (index + 1) / len(batches))
        await _set_progress(
            view_id,
            "llm",
            percent,
            f"AI is naming groups (batch {index + 1}/{len(batches)})",
        )
        plan = await _plan_with_retry(
            "classify/title_grouping",
            {"items": batch, "existing_groups": list(by_name)},
            view_id,
        )
        for group in plan.groups:
            name = _clean_group_name(group.name)
            if not name:
                continue
            existing = by_name.setdefault(name, ClusterAssignment(name=name))
            for sid in group.extra_source_ids:
                if sid not in existing.extra_source_ids:
                    existing.extra_source_ids.append(sid)

    return ClassificationPlan(groups=list(by_name.values())), {
        str(row["id"]) for row in source_rows
    }, untitled


def _resolve_assignments(
    plan: ClassificationPlan,
    cluster_members: Dict[str, List[str]],
    valid_source_ids: Set[str],
) -> Dict[str, List[str]]:
    """Turn the plan into name -> source ids, ignoring unknown ids; duplicate
    group names from the LLM are merged."""
    groups: Dict[str, List[str]] = {}
    for group in plan.groups:
        name = _clean_group_name(group.name)
        if not name:
            continue
        members = groups.setdefault(name, [])
        for cid in group.cluster_ids:
            for sid in cluster_members.get(str(cid), []):
                if sid in valid_source_ids and sid not in members:
                    members.append(sid)
        for sid in group.extra_source_ids:
            if sid in valid_source_ids and sid not in members:
                members.append(sid)
    return groups


def _rid_sql(record_id) -> str:
    """Render a RecordID as safe SQL text (ids are system-generated; the angle
    quoting covers keys with characters SurrealDB would not parse bare)."""
    key = str(record_id.id)
    table = str(record_id.table_name)
    if not re.fullmatch(r"[A-Za-z0-9_]+", key):
        key = f"⟨{key}⟩"
    return f"{table}:{key}"


async def _persist_groups(view_id: str, groups: Dict[str, List[str]]) -> None:
    """Overwrite the view's groups in one transaction, so the old grouping
    survives intact if anything before or during it fails.

    RELATE's arrow operands cannot take path expressions ($m.source), so the
    system-generated record ids are inlined and only the LLM-chosen names stay
    bound as parameters."""
    params: Dict[str, Any] = {"view": ensure_record_id(view_id)}
    statements = [
        "BEGIN TRANSACTION;",
        "DELETE source_group_member WHERE out IN "
        "(SELECT VALUE id FROM source_group WHERE source_view = $view);",
        "DELETE source_group WHERE source_view = $view;",
    ]
    for name, sids in groups.items():
        group_ref = ensure_record_id(f"source_group:{uuid.uuid4().hex}")
        param = f"name_{len(params)}"
        params[param] = name
        statements.append(
            f"CREATE {_rid_sql(group_ref)} CONTENT "
            f"{{ name: ${param}, source_view: $view }};"
        )
        for sid in sids:
            statements.append(
                f"RELATE {_rid_sql(ensure_record_id(sid))}"
                f"->source_group_member->{_rid_sql(group_ref)};"
            )
    statements.append("COMMIT TRANSACTION;")
    await repo_query("\n".join(statements), params)


@command("classify_sources", app="open_notebook", retry=CLASSIFY_RETRY_CONFIG)
async def classify_sources_command(input_data: ClassifySourcesInput) -> ClassifySourcesOutput:
    start_time = time.time()
    view_id = input_data.view_id
    try:
        view_rows = await repo_query(
            "SELECT id, view_type FROM $view_id", {"view_id": ensure_record_id(view_id)}
        )
        if not view_rows:
            raise ValueError(f"Source view {view_id} not found")

        if input_data.method == "content":
            plan, cluster_members, valid_ids, untitled = await _classify_content(view_id)
        else:
            plan, valid_ids, untitled = await _classify_title(view_id)
            cluster_members = {}

        await _set_progress(view_id, "assigning", *_STAGES["assigning"])

        groups = _resolve_assignments(plan, cluster_members, valid_ids)
        await _persist_groups(view_id, groups)
        assigned = sum(len(sids) for sids in groups.values())
        sources_classified = assigned
        unclassified = len(valid_ids) - assigned

        await repo_query(
            "UPDATE $view_id SET last_classified_at = time::now(), classify_progress = $progress",
            {
                "view_id": ensure_record_id(view_id),
                "progress": {
                    "stage": "done",
                    "percent": 100,
                    "message": f"{len(groups)} groups, {sources_classified} sources classified",
                    "error": None,
                    "groups_created": len(groups),
                    "sources_classified": sources_classified,
                    "unclassified": unclassified,
                },
            },
        )
        logger.info(
            f"[classify:{view_id}] done: {len(groups)} groups, "
            f"{sources_classified} classified, {unclassified} unclassified "
            f"({untitled} without title)"
        )
        return ClassifySourcesOutput(
            success=True,
            groups_created=len(groups),
            sources_classified=sources_classified,
            unclassified=unclassified,
            processing_time=time.time() - start_time,
        )
    except (ValueError, ConfigurationError) as e:
        # Terminal: retrying cannot fix it, and nothing was persisted (the old
        # grouping only changes inside the final transaction).
        await _set_progress(view_id, "failed", 100, error=str(e)[:500])
        raise
    except Exception as e:
        # Transient: the retry layer re-runs the command from scratch.
        logger.debug(f"Transient classification error for {view_id}: {e}")
        raise
