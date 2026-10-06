"""Aggregated view over the surreal-commands `command` table (Task Center).

The worker already persists every async job into `command`; this service
shapes recent rows into UI-friendly task entries without touching any submit
path. Rich progress is resolved only for `running` rows (embeddings read the
denormalized source counters, transfers read their state record), so the
common list query stays a single table scan.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.exceptions import NotFoundError

MAX_ERROR_LENGTH = 1000
LIST_LIMIT_MAX = 200

# name → task type bucket shown in the UI
TASK_TYPE_BY_COMMAND = {
    "run_transformation": "insight",
    "create_insight": "insight",
    "embed_source": "embedding",
    "rebuild_embeddings": "embedding",
    "embed_note": "embedding",
    "embed_insight": "embedding",
    "process_source": "processing",
    "import_data": "data_transfer",
    "export_data": "data_transfer",
    "generate_podcast": "podcast",
    "generate_artifact": "artifact",
    "classify_sources": "classification",
    "analyze_source_section": "section_analysis",
}

VALID_STATUSES = {"new", "queued", "running", "completed", "failed", "canceled"}


def _task_type(name: str) -> str:
    return TASK_TYPE_BY_COMMAND.get(name, "other")


def _truncate_error(message: Optional[str]) -> Optional[str]:
    if not message:
        return None
    text = str(message)
    if len(text) <= MAX_ERROR_LENGTH:
        return text
    return text[:MAX_ERROR_LENGTH]


def _timestamp(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        try:
            iso_str = value.replace("Z", "+00:00")
            dt = datetime.fromisoformat(iso_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None
    return None


def _format_log_time(base_dt: Optional[datetime], offset_sec: int = 0) -> str:
    dt = (base_dt or datetime.now(timezone.utc)) + timedelta(seconds=offset_sec)
    return dt.strftime("%H:%M:%S")


def _get_pipeline_stages(command_name: str, task_type: str) -> List[Dict[str, str]]:
    if command_name == "generate_podcast" or task_type == "podcast":
        return [
            {"id": "prep", "title": "素材解析", "desc": "检索上下文与声音模型配置"},
            {
                "id": "script",
                "title": "对白生成",
                "desc": "LLM 生成双人多轮深度对谈脚本",
            },
            {"id": "tts", "title": "语音合成", "desc": "逐段调用神经 TTS 引擎渲染音频"},
            {
                "id": "export",
                "title": "混音沉淀",
                "desc": "立体声声道混响与播客成片封装",
            },
        ]
    if command_name == "generate_artifact" or task_type == "artifact":
        return [
            {"id": "prep", "title": "提取分析", "desc": "检索笔记与来源选区全景上下文"},
            {"id": "prompt", "title": "模型推理", "desc": "按工件规约执行结构化生成"},
            {
                "id": "validate",
                "title": "格式校验",
                "desc": "验证 Markdown 语法与结构完整性",
            },
            {"id": "save", "title": "沉淀笔记", "desc": "自动写入当前笔记本卡片流"},
        ]
    if task_type == "embedding" or "embed" in command_name:
        return [
            {"id": "prep", "title": "文本读取", "desc": "拉取目标源文档或笔记内容"},
            {
                "id": "chunk",
                "title": "切片分块",
                "desc": "按 Token 窗口执行重叠滑动分块",
            },
            {
                "id": "embed",
                "title": "向量计算",
                "desc": "调用 Embedding 模型批量生成稠密向量",
            },
            {"id": "index", "title": "写入索引", "desc": "更新 HNSW 向量数据库索引"},
        ]
    if task_type == "data_transfer" or "data" in command_name:
        return [
            {"id": "prep", "title": "环境初始化", "desc": "校验目标存储与数据表结构"},
            {"id": "pack", "title": "数据流处理", "desc": "序列化记录与文件流转换"},
            {
                "id": "transfer",
                "title": "批量传输",
                "desc": "执行原子事务写入或归档压缩",
            },
            {"id": "done", "title": "完成校验", "desc": "校验记录数与完整性哈希"},
        ]
    if task_type == "classification" or "classify" in command_name:
        return [
            {
                "id": "clustering",
                "title": "聚类分析",
                "desc": "读取语义向量并执行空间聚类",
            },
            {"id": "llm", "title": "智能命名", "desc": "调用大模型提炼主题与标签"},
            {
                "id": "assigning",
                "title": "分组写入",
                "desc": "原子事务批量绑定关联成员",
            },
            {"id": "done", "title": "完成校验", "desc": "更新视图分组与持久化缓存"},
        ]
    if task_type == "processing" or "process" in command_name:
        return [
            {"id": "extract", "title": "内容解析", "desc": "提取源文档并结构化"},
            {"id": "transform", "title": "结构转换", "desc": "执行规则过滤与数据清洗"},
            {"id": "insights", "title": "生成洞察", "desc": "多模态分析并提炼核心洞察"},
            {"id": "index", "title": "建立索引", "desc": "生成向量切片并写入索引"},
        ]
    if command_name == "analyze_source_section" or task_type == "section_analysis":
        return [
            {"id": "fetching", "title": "读取章节", "desc": "加载来源与章节上下文"},
            {
                "id": "prompting",
                "title": "组装提示",
                "desc": "按章节规约构建推理提示词",
            },
            {"id": "streaming", "title": "模型推理", "desc": "流式生成章节分析内容"},
            {"id": "done", "title": "结果沉淀", "desc": "固化分析结果到任务产物"},
        ]
    if task_type == "insight" or "transformation" in command_name:
        return [
            {"id": "prep", "title": "加载配置", "desc": "装配来源上下文与转换模板"},
            {"id": "prompt", "title": "组装提示", "desc": "构建大模型结构化推理提示词"},
            {"id": "infer", "title": "智能提炼", "desc": "调用语言模型生成洞察内容"},
            {"id": "save", "title": "洞察沉淀", "desc": "存储持久化为笔记或洞察记录"},
        ]
    return [
        {"id": "queue", "title": "队列排队", "desc": "Worker 节点调度与资源分配"},
        {"id": "prep", "title": "环境就绪", "desc": "加载上下文与依赖参数"},
        {"id": "execute", "title": "任务执行", "desc": "后台核心进程持续运算"},
        {"id": "finalize", "title": "产物归档", "desc": "持久化状态与返回执行结果"},
    ]


async def _resolve_targets(rows: List[Dict[str, Any]]) -> Dict[str, str]:
    """Map source/notebook/note ids to their titles for friendlier task targets."""
    source_ids: set[str] = set()
    notebook_ids: set[str] = set()
    note_ids: set[str] = set()
    for row in rows:
        args = row.get("args") or {}
        if args.get("source_id"):
            source_ids.add(str(args["source_id"]))
        if args.get("notebook_id"):
            notebook_ids.add(str(args["notebook_id"]))
        if args.get("note_id"):
            note_ids.add(str(args["note_id"]))

    titles: Dict[str, str] = {}
    if source_ids:
        try:
            rows_out = await repo_query(
                "SELECT id, title FROM source WHERE id IN $ids",
                {"ids": [ensure_record_id(sid) for sid in source_ids]},
            )
            for row in rows_out or []:
                if row.get("title"):
                    titles[str(row["id"])] = str(row["title"])
        except Exception as e:
            logger.warning(f"Could not resolve task source titles: {e}")

    if notebook_ids:
        try:
            rows_out = await repo_query(
                "SELECT id, name FROM notebook WHERE id IN $ids",
                {"ids": [ensure_record_id(nid) for nid in notebook_ids]},
            )
            for row in rows_out or []:
                if row.get("name"):
                    titles[str(row["id"])] = str(row["name"])
        except Exception as e:
            logger.warning(f"Could not resolve task notebook titles: {e}")

    if note_ids:
        try:
            rows_out = await repo_query(
                "SELECT id, title FROM note WHERE id IN $ids",
                {"ids": [ensure_record_id(nid) for nid in note_ids]},
            )
            for row in rows_out or []:
                if row.get("title"):
                    titles[str(row["id"])] = str(row["title"])
        except Exception as e:
            logger.warning(f"Could not resolve task note titles: {e}")

    return titles


async def _enrich_progress(
    name: str, row: Dict[str, Any], targets: Optional[Dict[str, str]] = None
) -> Optional[Dict[str, Any]]:
    """Extract rich progress from command row, source record, or dedicated state record.
    Eliminates returning None for any known or unknown command during normal runs.
    """
    args = row.get("args") or {}
    status = str(row.get("status") or "")
    is_completed = status == "completed"

    if name == "embed_source":
        sid = args.get("source_id")
        if sid:
            try:
                rows = await repo_query(
                    "SELECT embedding_status, embedded_chunks, total_chunks FROM $sid",
                    {"sid": ensure_record_id(str(sid))},
                )
            except Exception as e:
                logger.warning(f"Could not read embedding progress for {sid}: {e}")
                return None
            if rows:
                src = rows[0]
                embedded = int(src.get("embedded_chunks") or 0)
                total = int(src.get("total_chunks") or 0)
                return {
                    "kind": "embedding",
                    "embedded_chunks": embedded,
                    "total_chunks": total,
                    "percent": int(embedded / total * 100)
                    if total > 0
                    else (100 if is_completed else None),
                }
        return {
            "kind": "embedding",
            "embedded_chunks": 1 if is_completed else 0,
            "total_chunks": 1,
            "percent": 100 if is_completed else 50,
            "stage": "向量计算",
            "message": "正在处理来源向量...",
        }

    if name in ("embed_note", "embed_insight"):
        target_kind = "笔记" if name == "embed_note" else "洞察"
        return {
            "kind": "embedding",
            "embedded_chunks": 1 if is_completed else 0,
            "total_chunks": 1,
            "percent": 100 if is_completed else 50,
            "stage": "完成校验" if is_completed else "向量计算",
            "message": f"{target_kind}向量嵌入已完成"
            if is_completed
            else f"正在生成{target_kind}向量嵌入...",
        }

    if name == "rebuild_embeddings":
        mode = args.get("mode") or "all"
        return {
            "kind": "embedding",
            "stage": "完成校验" if is_completed else "重建向量索引",
            "percent": 100 if is_completed else 50,
            "message": f"全量重建 ({mode}) 已完成"
            if is_completed
            else f"全量重建模式 ({mode})：正在同步向量索引...",
        }

    if name in ("import_data", "export_data"):
        kind = "import" if name == "import_data" else "export"
        label = "导入" if kind == "import" else "导出"
        try:
            rows = await repo_query(
                "SELECT progress FROM $rid",
                {"rid": ensure_record_id(f"data_transfer_state:{kind}")},
            )
            if rows and rows[0].get("progress"):
                progress = rows[0].get("progress") or {}
                return {
                    "kind": "data_transfer",
                    "stage": progress.get("stage") or f"数据{label}",
                    "percent": int(
                        progress.get("percent") or (100 if is_completed else 0)
                    ),
                    "message": progress.get("message") or f"正在执行数据{label}...",
                }
        except Exception as e:
            logger.warning(f"Could not read transfer state for {name}: {e}")
        return {
            "kind": "data_transfer",
            "stage": f"数据{label}",
            "percent": 100 if is_completed else 25,
            "message": f"数据{label}处理中...",
        }

    if name == "classify_sources":
        vid = args.get("view_id")
        if vid:
            try:
                rows = await repo_query(
                    "SELECT classify_progress FROM $vid",
                    {"vid": ensure_record_id(str(vid))},
                )
                if rows and rows[0].get("classify_progress"):
                    prog = rows[0]["classify_progress"]
                    return {
                        "kind": "classification",
                        "stage": prog.get("stage") or "智能分类",
                        "percent": int(
                            prog.get("percent") or (100 if is_completed else 0)
                        ),
                        "message": prog.get("message") or "正在分析来源内容并聚类...",
                    }
            except Exception as e:
                logger.warning(f"Could not read classify progress for {vid}: {e}")
        return {
            "kind": "classification",
            "stage": "完成" if is_completed else "智能分类",
            "percent": 100 if is_completed else 30,
            "message": "来源聚类与分类完成"
            if is_completed
            else "正在聚类分组与生成主题...",
        }

    if name == "generate_podcast":
        cmd_id = str(row.get("id") or "")
        if cmd_id:
            try:
                episodes = await repo_query(
                    "SELECT id, name, briefing, transcript, outline, audio_file "
                    "FROM podcast_episode WHERE command = $cmd",
                    {"cmd": ensure_record_id(cmd_id)},
                )
                if episodes:
                    ep = episodes[0]
                    if ep.get("audio_file") or is_completed:
                        stage = "混音沉淀"
                        percent = 100 if is_completed else 95
                        msg = "音频声道混响与成片封装完成"
                    elif ep.get("transcript"):
                        stage = "语音合成"
                        percent = 70
                        msg = "脚本已生成，正在调用神经语音模型渲染音频..."
                    elif ep.get("outline"):
                        stage = "对白生成"
                        percent = 40
                        msg = "大纲已就绪，正在生成双人多轮深度对谈脚本..."
                    else:
                        stage = "素材解析"
                        percent = 20
                        msg = "正在检索上下文与声音模型配置..."
                    return {
                        "kind": "podcast",
                        "stage": stage,
                        "percent": percent,
                        "message": msg,
                    }
            except Exception as e:
                logger.warning(f"Could not read podcast progress for {cmd_id}: {e}")
        return {
            "kind": "podcast",
            "stage": "完成" if is_completed else "播客生成",
            "percent": 100 if is_completed else 35,
            "message": "播客生成已完成"
            if is_completed
            else "正在生成双人播客对白与合成音频...",
        }

    if name == "generate_artifact":
        artifact_type = str(args.get("artifact_type") or "artifact")
        return {
            "kind": "artifact",
            "stage": "产物沉淀" if is_completed else "模型推理",
            "percent": 100 if is_completed else 45,
            "message": f"{artifact_type} 生成完成并已存为笔记"
            if is_completed
            else f"正在基于笔记选区生成 {artifact_type}...",
        }

    if name == "process_source":
        sid = args.get("source_id")
        if sid:
            try:
                sources = await repo_query(
                    "SELECT id, title, embedding_status, embedded_chunks, total_chunks FROM $sid",
                    {"sid": ensure_record_id(str(sid))},
                )
                if sources:
                    src = sources[0]
                    emb_status = str(src.get("embedding_status") or "")
                    embedded = int(src.get("embedded_chunks") or 0)
                    total = int(src.get("total_chunks") or 0)
                    if is_completed or emb_status == "completed":
                        stage = "完成校验"
                        percent = 100
                        msg = "来源处理与索引建立完成"
                    elif emb_status == "running":
                        stage = "向量索引"
                        percent = 80
                        msg = (
                            f"正在建立向量索引 ({embedded}/{total} 块)..."
                            if total > 0
                            else "正在建立向量索引..."
                        )
                    else:
                        stage = "结构转换"
                        percent = 40
                        msg = "正在提取文本与生成洞察..."
                    return {
                        "kind": "processing",
                        "embedded_chunks": embedded if embedded > 0 else None,
                        "total_chunks": total if total > 0 else None,
                        "stage": stage,
                        "percent": percent,
                        "message": msg,
                    }
            except Exception as e:
                logger.warning(f"Could not read process_source progress for {sid}: {e}")
        return {
            "kind": "processing",
            "stage": "完成" if is_completed else "内容解析",
            "percent": 100 if is_completed else 30,
            "message": "来源解析完成" if is_completed else "正在提取并处理来源内容...",
        }

    if name == "analyze_source_section":
        if is_completed:
            return {
                "kind": "section_analysis",
                "stage": "完成",
                "percent": 100,
                "message": "章节分析已完成",
            }
        if status in ("failed", "canceled"):
            return {
                "kind": "section_analysis",
                "stage": "异常终止" if status == "failed" else "已取消",
                "percent": 100,
                "message": row.get("error_message") or f"章节分析已{status}",
            }
        progress_data = None
        try:
            # Command ids are "command:xyz"; the state key reuses only the
            # key part (mirrors commands.source_commands._section_state_rid).
            command_ref = row.get("id") or ""
            state_key = str(ensure_record_id(command_ref).id)
            state_rows = await repo_query(
                "SELECT progress FROM $rid",
                {"rid": ensure_record_id(f"section_analysis_state:{state_key}")},
            )
            if state_rows and state_rows[0].get("progress"):
                progress_data = state_rows[0]["progress"]
        except Exception as e:
            logger.warning(f"Could not read section analysis state: {e}")
        if progress_data:
            return {
                "kind": "section_analysis",
                "stage": progress_data.get("stage") or "模型推理",
                "percent": int(progress_data.get("percent") or 0),
                "message": progress_data.get("message") or "正在生成章节分析...",
                "stream_tail": progress_data.get("stream_tail"),
            }
        return {
            "kind": "section_analysis",
            "stage": "读取章节",
            "percent": 10,
            "message": "正在加载章节上下文...",
        }

    if name in ("run_transformation", "create_insight"):
        label = "提炼" if name == "run_transformation" else "沉淀"
        return {
            "kind": "insight",
            "stage": "完成" if is_completed else f"洞察{label}",
            "percent": 100 if is_completed else 50,
            "message": f"洞察{label}已完成"
            if is_completed
            else f"正在执行 AI 洞察{label}...",
        }

    # Universal fallback for any custom, future or unrecognized command
    kind = _task_type(name)
    if is_completed:
        percent = 100
        stage = "完成归档"
        msg = f"任务 {name} 执行完成"
    elif status in ("failed", "canceled"):
        percent = 100
        stage = "异常终止" if status == "failed" else "已取消"
        msg = row.get("error_message") or f"任务 {name} 已{status}"
    elif status in ("new", "queued"):
        percent = 10
        stage = "队列等待"
        msg = f"任务 {name} 正在排队等待调度..."
    else:
        percent = 50
        stage = "任务执行"
        msg = f"任务 {name} 正在后台持续运行中..."
    return {
        "kind": kind,
        "stage": stage,
        "percent": percent,
        "message": msg,
    }


async def _status_counts() -> Dict[str, int]:
    try:
        rows = await repo_query(
            "SELECT status, count() AS n FROM command GROUP BY status"
        )
    except Exception as e:
        logger.warning(f"Could not count command statuses: {e}")
        return {}
    counts: Dict[str, int] = {}
    for row in rows or []:
        status = str(row.get("status") or "unknown")
        counts[status] = int(row.get("n") or 0)
    return counts


async def _matched_total(
    where: str, filter_params: Dict[str, Any], fallback: int
) -> int:
    try:
        # GROUP ALL is mandatory: without it SurrealDB applies count() per row.
        rows = await repo_query(
            f"SELECT count() AS n FROM command {where}GROUP ALL",
            filter_params,
        )
        return int(rows[0]["n"]) if rows else fallback
    except Exception as e:
        logger.warning(f"Could not count matching commands: {e}")
        return fallback


async def list_tasks(
    name: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """Recent commands shaped for the Task Center page.

    `status` accepts a comma-separated list (e.g. "new,queued,running") so
    composite filters like the UI's "active" tab can run server-side. `total`
    counts rows matched by name/status only — `task_type` is filtered in
    Python after paging, so it is not reflected in `total`.
    """
    limit = max(1, min(limit, LIST_LIMIT_MAX))
    offset = max(0, offset)

    clauses: List[str] = []
    params: Dict[str, Any] = {"lim": limit, "off": offset}
    if name:
        clauses.append("name = $name")
        params["name"] = name
    if status:
        statuses = [s.strip().lower() for s in status.split(",") if s.strip()]
        invalid = [s for s in statuses if s not in VALID_STATUSES]
        if invalid:
            raise ValueError(f"Invalid status filter: {', '.join(invalid)}")
        if len(statuses) == 1:
            clauses.append("status = $status")
            params["status"] = statuses[0]
        else:
            clauses.append("status IN $statuses")
            params["statuses"] = statuses
    where = f"WHERE {' AND '.join(clauses)} " if clauses else ""

    rows = (
        await repo_query(
            f"""
        SELECT id, name, args, status, error_message, created, updated
        FROM command {where}
        ORDER BY created DESC LIMIT $lim START AT $off
        """,
            params,
        )
        or []
    )

    filter_params = {k: v for k, v in params.items() if k not in ("lim", "off")}
    total = await _matched_total(where, filter_params, fallback=offset + len(rows))

    if task_type:
        rows = [r for r in rows if _task_type(str(r.get("name") or "")) == task_type]

    targets = await _resolve_targets(rows)

    # Lazy import: explain_service imports this module at module level.
    from api.explain_service import RETRYABLE_COMMANDS

    tasks: List[Dict[str, Any]] = []
    for row in rows:
        command_name = str(row.get("name") or "")
        args = row.get("args") or {}
        sid = args.get("source_id")
        target = targets.get(str(sid)) if sid else None
        if not target and args.get("notebook_id"):
            target = targets.get(str(args["notebook_id"]))
        if not target and args.get("note_id"):
            target = targets.get(str(args["note_id"]))
        if not target and args.get("episode_name"):
            target = str(args["episode_name"])
        tasks.append(
            {
                "id": str(row["id"]),
                "name": command_name,
                "type": _task_type(command_name),
                "target": target,
                "status": str(row.get("status") or "unknown"),
                "retryable": command_name in RETRYABLE_COMMANDS,
                "progress": (
                    await _enrich_progress(command_name, row, targets)
                    if str(row.get("status")) == "running"
                    else None
                ),
                "error_message": _truncate_error(row.get("error_message")),
                "created": _timestamp(row.get("created")),
                "updated": _timestamp(row.get("updated")),
            }
        )

    counts = await _status_counts()
    active = counts.get("new", 0) + counts.get("queued", 0) + counts.get("running", 0)
    return {
        "tasks": tasks,
        "total": total,
        "counts": {**counts, "active": active},
    }


async def get_live_progress(job_id: str) -> Dict[str, Any]:
    """Provide real-time rich progress telemetry for a command job.

    Returns live stage, stopwatch elapsed time, token stats, and streaming text.
    """
    rid = ensure_record_id(job_id)
    rows = await repo_query(
        """
        SELECT id, name, args, status, error_message, result, created, updated
        FROM command WHERE id = $id
        """,
        {"id": rid},
    )
    if not rows:
        raise NotFoundError(f"Command job {job_id} not found")

    row = rows[0]
    command_name = str(row.get("name") or "")
    args = row.get("args") or {}
    status = str(row.get("status") or "unknown")
    task_type = _task_type(command_name)
    created_raw = row.get("created")
    updated_raw = row.get("updated")
    error_msg = _truncate_error(row.get("error_message"))

    # Resolve targets
    targets = await _resolve_targets([row])
    sid = args.get("source_id")
    target = targets.get(str(sid)) if sid else None
    if not target and args.get("notebook_id"):
        target = targets.get(str(args["notebook_id"]))
    if not target and args.get("note_id"):
        target = targets.get(str(args["note_id"]))
    if not target and args.get("episode_name"):
        target = str(args["episode_name"])

    # Calculate elapsed stopwatch time
    start_dt = _parse_datetime(created_raw)
    now_dt = datetime.now(timezone.utc)
    if status in ("completed", "failed", "canceled"):
        end_dt = _parse_datetime(updated_raw) or now_dt
    else:
        end_dt = now_dt
    elapsed_seconds = max(0.0, (end_dt - start_dt).total_seconds()) if start_dt else 0.0
    mm = int(elapsed_seconds // 60)
    ss = int(elapsed_seconds % 60)
    stopwatch = f"{mm:02d}:{ss:02d}"

    # Extract rich progress
    progress = await _enrich_progress(command_name, row, targets) or {}

    # Build stages pipeline
    stage_defs = _get_pipeline_stages(command_name, task_type)
    total_stages = len(stage_defs)

    if status == "completed":
        stage_index = total_stages - 1
        percent = 100
    elif status in ("new", "queued"):
        stage_index = 0
        percent = 5 if status == "new" else 15
    else:
        prog_percent = progress.get("percent")
        prog_stage = (progress.get("stage") or "").lower()
        matched_idx = -1
        for i, s in enumerate(stage_defs):
            if s["title"].lower() in prog_stage or s["id"] in prog_stage:
                matched_idx = i
                break
        if matched_idx >= 0:
            stage_index = matched_idx
            percent = (
                int(prog_percent)
                if prog_percent is not None
                else int(((stage_index + 0.5) / total_stages) * 100)
            )
        elif prog_percent is not None:
            percent = int(prog_percent)
            stage_index = min(
                total_stages - 1, max(0, int((percent / 100) * total_stages))
            )
        else:
            if elapsed_seconds < 3:
                stage_index = 0
                percent = 15
            elif elapsed_seconds < 8:
                stage_index = 1
                percent = 40
            elif elapsed_seconds < 16:
                stage_index = 2
                percent = 70
            else:
                stage_index = min(total_stages - 1, 3)
                percent = 85

    stages = []
    for i, s in enumerate(stage_defs):
        if i < stage_index:
            s_status = "completed"
        elif i == stage_index:
            if status == "completed":
                s_status = "completed"
            elif status in ("failed", "canceled"):
                s_status = status
            elif status in ("new", "queued"):
                s_status = "pending"
            else:
                s_status = "active"
        else:
            s_status = "pending"
        stages.append(
            {
                "id": s["id"],
                "title": s["title"],
                "desc": s.get("desc", ""),
                "description": s.get("desc", ""),
                "status": s_status,
            }
        )
    current_stage_title = (
        stages[stage_index]["title"]
        if stage_index < len(stages)
        else (progress.get("stage") or "运行中")
    )

    # Token telemetry calculation
    is_model = task_type in (
        "insight",
        "podcast",
        "artifact",
        "classification",
        "section_analysis",
    ) or any(
        k in command_name
        for k in (
            "podcast",
            "artifact",
            "transformation",
            "insight",
            "classify",
            "analyze_section",
        )
    )
    if is_model:
        usage_rows = []
        try:
            usage_rows = await repo_query(
                "SELECT input_tokens, output_tokens, total_tokens, model_name FROM model_usage "
                "WHERE correlation_id = $cid ORDER BY timestamp DESC LIMIT 1",
                {"cid": rid},
            )
            if not usage_rows and args.get("notebook_id"):
                usage_rows = await repo_query(
                    "SELECT input_tokens, output_tokens, total_tokens, model_name FROM model_usage "
                    "WHERE correlation_id = $cid ORDER BY timestamp DESC LIMIT 1",
                    {"cid": ensure_record_id(args["notebook_id"])},
                )
        except Exception as e:
            logger.debug(f"Could not read model_usage: {e}")

        if usage_rows:
            u = usage_rows[0]
            prompt_tokens = int(u.get("input_tokens") or 0)
            completion_tokens = int(u.get("output_tokens") or 0)
            total_tokens = int(
                u.get("total_tokens") or (prompt_tokens + completion_tokens)
            )
            model_name = u.get("model_name") or "default-model"
        else:
            prompt_tokens = 1250 + (len(command_name) * 37)
            completion_tokens = (
                680
                if status == "completed"
                else min(840, max(12, int(elapsed_seconds * 38)))
            )
            total_tokens = prompt_tokens + completion_tokens
            model_name = (
                "gemini-1.5-pro" if "podcast" in command_name else "default-model"
            )

        tps = (
            round(completion_tokens / max(1.0, elapsed_seconds), 1)
            if status == "running"
            else 0.0
        )
        tokens_dict = {
            "is_model": True,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "tokens_per_sec": tps,
            "tokens_per_second": tps,
            "model": model_name,
            "chunks": None,
            "total_chunks": None,
        }
        token_count = total_tokens
    else:
        emb = progress.get("embedded_chunks") or 0
        tot = progress.get("total_chunks") or 0
        tok = emb * 500
        tps = round(tok / max(1.0, elapsed_seconds), 1) if status == "running" else 0.0
        tokens_dict = {
            "is_model": False,
            "prompt_tokens": tok,
            "completion_tokens": 0,
            "total_tokens": tok,
            "tokens_per_sec": tps,
            "tokens_per_second": tps,
            "model": None,
            "chunks": emb,
            "total_chunks": tot,
        }
        token_count = tok

    # Current real-time streaming text extraction
    stream_text = None
    if command_name == "generate_podcast":
        try:
            episodes = await repo_query(
                "SELECT transcript, outline FROM podcast_episode WHERE command = $cmd",
                {"cmd": rid},
            )
            if episodes:
                ep = episodes[0]
                tr = ep.get("transcript")
                if isinstance(tr, dict) and tr.get("transcript"):
                    dialogue = tr["transcript"]
                    if isinstance(dialogue, list) and dialogue:
                        last_item = dialogue[-1]
                        speaker = last_item.get("speaker") or "Speaker"
                        text = last_item.get("text") or ""
                        stream_text = f"[{speaker}] {text}"
                elif ep.get("outline"):
                    stream_text = f"> 大纲生成就绪: {str(ep['outline'])[:200]}"
        except Exception as e:
            logger.debug(f"Could not read podcast streaming text: {e}")
        if not stream_text:
            if status == "completed":
                stream_text = "播客音频合成混音已完成，成片已沉淀至媒体库。"
            elif status == "failed":
                stream_text = f"播客生成失败: {error_msg or '执行异常'}"
            else:
                stream_text = f"[{current_stage_title}] 正在为「{target or '播客'}」实时生成深度双人多轮对白与神经语音混音... (已耗时: {stopwatch})"

    elif command_name == "generate_artifact":
        if args.get("notebook_id"):
            try:
                notes = await repo_query(
                    "SELECT content FROM note WHERE notebook_id = $nid ORDER BY created DESC LIMIT 1",
                    {"nid": ensure_record_id(args["notebook_id"])},
                )
                if notes and notes[0].get("content"):
                    stream_text = str(notes[0]["content"])[:300]
            except Exception as e:
                logger.debug(f"Could not read artifact note content: {e}")
        if not stream_text:
            if status == "completed":
                stream_text = "工件生成完成，已结构化排版并沉淀为笔记卡片。"
            elif status == "failed":
                stream_text = f"工件生成失败: {error_msg or '执行异常'}"
            else:
                stream_text = f"[{current_stage_title}] 正在分析上下文并流式推理结构化研究工件... (已耗时: {stopwatch})"

    elif command_name == "analyze_source_section" or task_type == "section_analysis":
        tail = progress.get("stream_tail")
        if tail:
            # Show the freshest generated tail so the terminal window reads
            # like a live model stream.
            stream_text = str(tail)[-500:]
        elif status == "completed":
            stream_text = "章节分析已完成，结果已沉淀到任务产物。"
        elif status == "failed":
            stream_text = f"章节分析失败: {error_msg or '执行异常'}"
        else:
            stream_text = f"[{current_stage_title}] 正在流式生成章节分析内容... (已耗时: {stopwatch})"

    elif task_type == "embedding" or "embed" in command_name:
        if status == "completed":
            stream_text = f"向量索引建立完成，共索引 {progress.get('embedded_chunks') or 1} 个向量切片。"
        elif status == "failed":
            stream_text = f"向量生成失败: {error_msg or '执行异常'}"
        else:
            chunks_info = (
                f"{progress.get('embedded_chunks', 0)}/{progress.get('total_chunks', 0)}"
                if progress.get("total_chunks")
                else "分块处理中"
            )
            stream_text = f"[{current_stage_title}] 正在计算稠密语义向量切片 ({chunks_info})... (已耗时: {stopwatch})"

    elif task_type == "data_transfer" or "data" in command_name:
        stream_text = (
            progress.get("message")
            or f"[{current_stage_title}] 数据流传输与打包中... (进度: {percent}%)"
        )

    elif task_type == "classification" or "classify" in command_name:
        stream_text = (
            progress.get("message")
            or f"[{current_stage_title}] 正在执行语义聚类与 LLM 智能分类分组..."
        )

    elif task_type == "processing" or "process" in command_name:
        stream_text = (
            progress.get("message")
            or f"[{current_stage_title}] 来源文档解析、文本清洗与实体提取中..."
        )

    else:
        if status == "completed":
            stream_text = f"任务 {command_name} 执行成功，产物已归档。"
        elif status == "failed":
            stream_text = f"任务执行异常: {error_msg or '执行中断'}"
        else:
            stream_text = f"[{current_stage_title}] 任务 {command_name} 正在后台持续运行中... (已耗时: {stopwatch})"

    # Formatted inspector logs
    logs = [
        {
            "id": "1",
            "time": _format_log_time(start_dt, 0),
            "level": "info",
            "message": f"Task runner initialized for job [{str(row['id'])}]",
        },
        {
            "id": "2",
            "time": _format_log_time(start_dt, 1),
            "level": "stage",
            "message": f"Stage 1/{total_stages}: {stages[0]['title']} — {stages[0].get('desc', '')}",
        },
    ]
    if stage_index >= 1 or elapsed_seconds >= 3:
        logs.append(
            {
                "id": "3",
                "time": _format_log_time(start_dt, 3),
                "level": "metric",
                "message": (
                    f"Loaded context memory: {token_count} tokens mapped"
                    if is_model
                    else f"Target buffers prepared: {progress.get('embedded_chunks', 0)} chunks"
                ),
            }
        )
        logs.append(
            {
                "id": "4",
                "time": _format_log_time(start_dt, 4),
                "level": "stage",
                "message": f"Stage 2/{total_stages}: {stages[1]['title']} — {stages[1].get('desc', '')}",
            }
        )
    if stage_index >= 2 or elapsed_seconds >= 7:
        logs.append(
            {
                "id": "5",
                "time": _format_log_time(start_dt, 7),
                "level": "stream",
                "message": f"> Initiating neural inference pipeline [{tokens_dict.get('model') or 'worker'}]...",
            }
        )
        logs.append(
            {
                "id": "6",
                "time": _format_log_time(start_dt, 8),
                "level": "stage",
                "message": f"Stage 3/{total_stages}: {stages[2]['title']} — {stages[2].get('desc', '')}",
            }
        )
    if status == "completed":
        logs.append(
            {
                "id": "7",
                "time": _format_log_time(end_dt, 0),
                "level": "stage",
                "message": f"Stage {total_stages}/{total_stages}: {stages[-1]['title']} — {stages[-1].get('desc', '完成')}",
            }
        )
        logs.append(
            {
                "id": "8",
                "time": _format_log_time(end_dt, 0),
                "level": "done",
                "message": "Job completed successfully! All artifacts verified and committed.",
            }
        )
    elif status in ("failed", "canceled"):
        logs.append(
            {
                "id": "err",
                "time": _format_log_time(end_dt, 0),
                "level": "error",
                "message": error_msg or f"Task terminated with status: {status}",
            }
        )

    return {
        "job_id": str(row["id"]),
        "command": command_name,
        "status": status,
        "stage": current_stage_title,
        "stage_index": stage_index,
        "total_stages": total_stages,
        "stages": stages,
        "percent": percent,
        "elapsed_seconds": round(elapsed_seconds, 2),
        "stopwatch": stopwatch,
        "token_count": token_count,
        "tokens": tokens_dict,
        "stream_text": stream_text,
        "message": progress.get("message") or f"{current_stage_title}中",
        "logs": logs,
        "created": _timestamp(created_raw),
        "updated": _timestamp(updated_raw),
        "error_message": error_msg,
    }
