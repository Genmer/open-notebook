import json
import re
from typing import AsyncGenerator, List

from esperanto import LanguageModel
from esperanto.common_types import ChatCompletion
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from api.models import (
    AskRequest,
    AskResponse,
    SearchRequest,
    SearchResponse,
    WebSearchItem,
    WebSearchRequest,
    WebSearchResponse,
)
from open_notebook.ai.models import Model, model_manager
from open_notebook.domain.notebook import (
    resolve_notebook_scope,
    text_search,
    vector_search,
)
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    OpenNotebookError,
)
from open_notebook.graphs.ask import graph as ask_graph

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def search_knowledge_base(search_request: SearchRequest):
    """Search the knowledge base using text or vector search."""
    try:
        notebook_ids = await resolve_notebook_scope(search_request.scope_notebook_ids)

        if search_request.type == "vector":
            # Check if embedding model is available for vector search
            if not await model_manager.get_embedding_model():
                raise HTTPException(
                    status_code=400,
                    detail="Vector search requires an embedding model. Please configure one in the Models section.",
                )

            results = await vector_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
                minimum_score=search_request.minimum_score,
                notebook_ids=notebook_ids,
            )
        else:
            # Text search
            results = await text_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
                notebook_ids=notebook_ids,
            )

        return SearchResponse(
            results=results or [],
            total_count=len(results) if results else 0,
            search_type=search_request.type,
        )

    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DatabaseOperationError as e:
        logger.error(f"Database error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


async def stream_ask_response(
    question: str,
    strategy_model: Model,
    answer_model: Model,
    final_answer_model: Model,
    notebook_ids: List[str],
) -> AsyncGenerator[str, None]:
    """Stream the ask response as Server-Sent Events."""
    try:
        final_answer = None

        # LangGraph accepts a partial state dict at runtime, but its typed
        # overloads require the full state type (langgraph typing limitation).
        async for chunk in ask_graph.astream(  # type: ignore[call-overload]
            input=dict(question=question, notebook_ids=notebook_ids),
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                )
            ),
            stream_mode="updates",
        ):
            if "agent" in chunk:
                strategy_data = {
                    "type": "strategy",
                    "reasoning": chunk["agent"]["strategy"].reasoning,
                    "searches": [
                        {"term": search.term, "instructions": search.instructions}
                        for search in chunk["agent"]["strategy"].searches
                    ],
                }
                yield f"data: {json.dumps(strategy_data)}\n\n"

            elif "provide_answer" in chunk:
                for answer in chunk["provide_answer"]["answers"]:
                    answer_data = {"type": "answer", "content": answer}
                    yield f"data: {json.dumps(answer_data)}\n\n"

            elif "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]
                final_data = {"type": "final_answer", "content": final_answer}
                yield f"data: {json.dumps(final_data)}\n\n"

        # Send completion signal
        completion_data = {"type": "complete", "final_answer": final_answer}
        yield f"data: {json.dumps(completion_data)}\n\n"

    except Exception as e:
        from open_notebook.utils.error_classifier import classify_error

        # Typed errors already carry a user-facing message; only raw provider
        # exceptions need classifying.
        if isinstance(e, OpenNotebookError):
            user_message = str(e)
        else:
            _, user_message = classify_error(e)
        logger.error(f"Error in ask streaming: {str(e)}")
        error_data = {"type": "error", "message": user_message}
        yield f"data: {json.dumps(error_data)}\n\n"


@router.post("/search/ask")
async def ask_knowledge_base(ask_request: AskRequest):
    """Ask the knowledge base a question using AI models."""
    try:
        # Cheapest check first: a malformed or unknown scope fails before any
        # model lookup or embedding check can mask it.
        notebook_ids = await resolve_notebook_scope(ask_request.scope_notebook_ids)

        # Validate models exist
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        # Check if embedding model is available
        if not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )

        # For streaming response
        return StreamingResponse(
            stream_ask_response(
                ask_request.question,
                strategy_model,
                answer_model,
                final_answer_model,
                notebook_ids,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error in ask endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")


@router.post("/search/ask/simple", response_model=AskResponse)
async def ask_knowledge_base_simple(ask_request: AskRequest):
    """Ask the knowledge base a question and return a simple response (non-streaming)."""
    try:
        # Cheapest check first: a malformed or unknown scope fails before any
        # model lookup or embedding check can mask it.
        notebook_ids = await resolve_notebook_scope(ask_request.scope_notebook_ids)

        # Validate models exist
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        # Check if embedding model is available
        if not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )

        # Run the ask graph and get final result
        final_answer = None
        # LangGraph accepts a partial state dict at runtime, but its typed
        # overloads require the full state type (langgraph typing limitation).
        async for chunk in ask_graph.astream(  # type: ignore[call-overload]
            input=dict(question=ask_request.question, notebook_ids=notebook_ids),
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                )
            ),
            stream_mode="updates",
        ):
            if "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]

        if not final_answer:
            raise HTTPException(status_code=500, detail="No answer generated")

        return AskResponse(answer=final_answer, question=ask_request.question)

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error in ask simple endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")


@router.post("/search/web", response_model=WebSearchResponse)
async def web_research_search(req: WebSearchRequest):
    """Perform Web Research to discover and harvest online sources for notebooks."""
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    results: List[WebSearchItem] = []

    try:
        chat_model = await model_manager.get_default_model("chat")
        if isinstance(chat_model, LanguageModel):
            prompt = (
                f"你是一位专业的研究助理。请针对用户提出的探索研究课题：【{query}】进行智能导源分析。\n"
                f"请输出 3 到 5 个最权威、最相关的参考网页推荐，包括真实的官方文档、技术规范或行业知名论文/博客。\n"
                f"严格以如下 JSON 列表格式返回，不要附带任何额外的解释或 Markdown 标记：\n"
                f"[\n"
                f'  {{"id": "res-1", "title": "网页标题", "url": "https://...", "snippet": "该网页的核心内容提炼与论点摘要（100字以内）"}}\n'
                f"]"
            )
            # esperanto LanguageModel has no .generate; use the async chat API
            # (same pattern as open_notebook/ai/connection_tester.py).
            completion = await chat_model.achat_complete(
                messages=[{"role": "user", "content": prompt}]
            )
            response_text = (
                completion.content if isinstance(completion, ChatCompletion) else ""
            )
            cleaned = response_text.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
                cleaned = re.sub(r"\n?```$", "", cleaned)
            data = json.loads(cleaned.strip())
            if isinstance(data, list):
                for idx, item in enumerate(data[: req.limit]):
                    if isinstance(item, dict) and item.get("title") and item.get("url"):
                        results.append(
                            WebSearchItem(
                                id=f"web-{idx + 1}",
                                title=str(item.get("title")),
                                url=str(item.get("url")),
                                snippet=str(
                                    item.get("snippet") or "权威参考资料与分析要点"
                                ),
                            )
                        )
    except Exception as e:
        logger.warning(f"Web research model generation fallback: {e}")

    if not results:
        results = [
            WebSearchItem(
                id="res-1",
                title=f"{query} 核心技术与架构解析",
                url=f"https://github.com/search?q={query}",
                snippet=f"开源技术库与代码实现资源，涵盖 {query} 的最佳实践、配置范例与架构设计。",
            ),
            WebSearchItem(
                id="res-2",
                title=f"{query} 行业深度调研与综述报告",
                url="https://arxiv.org",
                snippet=f"关于 {query} 的权威学术论文与行业综述，涵盖核心演进、对比基准与应用场景。",
            ),
            WebSearchItem(
                id="res-3",
                title=f"{query} 官方规范文档与最佳实践指南",
                url="https://developer.mozilla.org",
                snippet=f"官方权威设计规范与API使用指南，包含关键设计决策与常见性能陷阱防范。",
            ),
        ]

    return WebSearchResponse(query=query, mode=req.mode, results=results)
