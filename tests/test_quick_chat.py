"""API tests for the stateless quick-ask side chat (POST /api/chat_quick).

The only seams are the module-global names the router resolves at call time
(provisioning, agent binding, usage recording) — the endpoint itself touches
no database, so every test also pins ZERO repository access as a side effect
of patching nothing there.
"""

import asyncio
import json as _json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _request(**overrides) -> dict:
    data = {
        "messages": [
            {"role": "user", "content": "之前的问题"},
            {"role": "assistant", "content": "之前的回答"},
            {"role": "user", "content": "今天天气怎么样"},
        ],
        "model_id": None,
        "agent_id": None,
        "context_blocks": [],
    }
    data.update(overrides)
    return data


class _FakeModel:
    def __init__(self, pieces=None, error: Exception | None = None, delay: float = 0.0):
        self.pieces = pieces or []
        self.error = error
        self.delay = delay
        self.seen_payload: Any = None
        self.seen_kwargs: Any = None

    def model_copy(self, update=None):
        return self  # the streaming=True flip is a no-op on the fake

    async def astream(self, payload, **kwargs):
        self.seen_payload = payload
        self.seen_kwargs = kwargs
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        for piece in self.pieces:
            yield SimpleNamespace(content=piece)


def _parse_sse(text: str) -> list:
    events = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(_json.loads(line[len("data: ") :]))
    return events


def _fake_agent(
    system_prompt: str = "你是软考论文教练",
    model_id: str | None = "model:agent-default",
    temperature: float | None = 0.2,
    max_tokens: int | None = 2048,
):
    return SimpleNamespace(
        system_prompt=system_prompt,
        model_id=model_id,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def test_stream_success_deltas_then_complete():
    """Raw deltas in order; the complete event carries the joined (and
    thinking-cleaned) text; usage is recorded with success=True."""
    client = _client()
    model = _FakeModel(pieces=["<think>推理</think>", "你好", "世界"])

    with (
        patch(
            "api.routers.quick_chat.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(langchain_model=model),
        ),
        patch("api.routers.quick_chat.record_llm_usage_sync") as usage_mock,
    ):
        with client.stream("POST", "/api/chat_quick", json=_request()) as response:
            assert response.status_code == 200
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    deltas = [e for e in events if e["type"] == "delta"]
    completes = [e for e in events if e["type"] == "complete"]
    assert [d["content"] for d in deltas] == ["<think>推理</think>", "你好", "世界"]
    assert len(completes) == 1
    assert completes[0]["content"] == "你好世界"
    # 系统消息：无智能体 → 默认人设
    payload = model.seen_payload
    assert payload[0].type == "system"
    assert "quick-ask assistant" in payload[0].content
    # 历史原样进入 payload，最后一条 user 在末尾
    assert [m.type for m in payload[1:]] == ["human", "ai", "human"]
    assert payload[-1].content == "今天天气怎么样"
    assert model.seen_kwargs.get("stream_usage") in (True, None)
    usage_mock.assert_called_once()
    assert usage_mock.call_args.kwargs["success"] is True


def test_agent_persona_and_model_resolution():
    """智能体给 system_prompt/温度/max_tokens；显式 model_id 覆盖智能体模型，
    未显式指定时落到智能体的模型。"""
    client = _client()
    model = _FakeModel(pieces=["好的"])

    with (
        patch(
            "api.routers.quick_chat.resolve_agent_binding",
            new_callable=AsyncMock,
            return_value=_fake_agent(),
        ) as agent_mock,
        patch(
            "api.routers.quick_chat.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(langchain_model=model),
        ) as prov_mock,
        patch("api.routers.quick_chat.record_llm_usage_sync"),
    ):
        with client.stream(
            "POST",
            "/api/chat_quick",
            json=_request(agent_id="agent:1", model_id="model:y"),
        ) as response:
            body1 = "".join(chunk for chunk in response.iter_text())
        with client.stream(
            "POST", "/api/chat_quick", json=_request(agent_id="agent:1")
        ) as response:
            body2 = "".join(chunk for chunk in response.iter_text())

    assert [e["type"] for e in _parse_sse(body1)] == ["delta", "complete"]
    assert [e["type"] for e in _parse_sse(body2)] == ["delta", "complete"]
    assert agent_mock.await_count == 2
    # 显式模型优先
    assert prov_mock.call_args_list[0].args[1] == "model:y"
    # 未显式指定 → 智能体模型
    assert prov_mock.call_args_list[1].args[1] == "model:agent-default"
    # 智能体参数透传 provision
    for call in prov_mock.call_args_list:
        assert call.kwargs["temperature"] == 0.2
        assert call.kwargs["max_tokens"] == 2048
    # 智能体 system_prompt 生效
    assert "你是软考论文教练" in model.seen_payload[0].content


def test_context_blocks_folded_into_final_user_message():
    client = _client()
    model = _FakeModel(pieces=["答"])

    with (
        patch(
            "api.routers.quick_chat.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(langchain_model=model),
        ),
        patch("api.routers.quick_chat.record_llm_usage_sync"),
    ):
        with client.stream(
            "POST",
            "/api/chat_quick",
            json=_request(
                context_blocks=[
                    {"label": "段落", "text": "负载均衡章节的正文片段"},
                    {"label": "", "text": "  "},  # 空白块被丢弃
                ]
            ),
        ) as response:
            body = "".join(chunk for chunk in response.iter_text())

    assert [e["type"] for e in _parse_sse(body)] == ["delta", "complete"]
    final = model.seen_payload[-1].content
    assert "负载均衡章节的正文片段" in final
    assert "[段落]" in final
    assert final.endswith("今天天气怎么样")


def test_context_budget_drops_oldest_blocks():
    from api.routers.quick_chat import (
        MAX_CONTEXT_BLOCK_CHARS,
        MAX_CONTEXT_TOTAL_CHARS,
        QuickChatMessage,
        QuickContextBlock,
        build_quick_chat_payload,
    )

    blocks = [
        QuickContextBlock(label=f"b{i}", text="x" * MAX_CONTEXT_BLOCK_CHARS)
        for i in range(4)
    ]
    messages = [QuickChatMessage(**m) for m in _request()["messages"]]
    payload = build_quick_chat_payload(messages, None, blocks)
    final = payload[-1].content
    kept = MAX_CONTEXT_TOTAL_CHARS // MAX_CONTEXT_BLOCK_CHARS  # 3 newest survive
    assert f"[b{kept}]" in final and f"[b{kept - 1}]" in final
    assert "[b0]" not in final


def test_invalid_last_message_422_before_stream():
    client = _client()
    for bad in (
        [],  # 空
        [{"role": "assistant", "content": "尾随助手"}],  # 最后一条不是 user
        [{"role": "user", "content": "   "}],  # 空白 user
    ):
        response = client.post("/api/chat_quick", json={"messages": bad})
        assert response.status_code == 422
        assert response.json()["detail"]["reason"] == "no_message"


def test_model_failure_emits_error_and_skips_usage():
    client = _client()
    model = _FakeModel(error=ValueError("provider boom"))

    with (
        patch(
            "api.routers.quick_chat.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(langchain_model=model),
        ),
        patch("api.routers.quick_chat.record_llm_usage_sync") as usage_mock,
    ):
        with client.stream("POST", "/api/chat_quick", json=_request()) as response:
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    assert [e["type"] for e in events] == ["error"]
    assert events[0]["reason"] == "model_error"
    usage_mock.assert_not_called()


def test_timeout_emits_model_timeout_error_event():
    client = _client()
    model = _FakeModel(pieces=["x"], delay=0.3)

    with (
        patch("api.routers.quick_chat.QUICK_CHAT_TIMEOUT_SECONDS", 0.05),
        patch(
            "api.routers.quick_chat.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(langchain_model=model),
        ),
        patch("api.routers.quick_chat.record_llm_usage_sync"),
    ):
        with client.stream("POST", "/api/chat_quick", json=_request()) as response:
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    assert [e["type"] for e in events] == ["error"]
    assert events[0]["reason"] == "model_timeout"


def test_configuration_error_maps_to_no_model():
    from open_notebook.exceptions import ConfigurationError

    client = _client()
    with (
        patch(
            "api.routers.quick_chat.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            side_effect=ConfigurationError("no default chat model"),
        ),
        patch("api.routers.quick_chat.record_llm_usage_sync"),
    ):
        with client.stream("POST", "/api/chat_quick", json=_request()) as response:
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    assert [e["type"] for e in events] == ["error"]
    assert events[0]["reason"] == "no_model"
    assert "no default chat model" in events[0]["message"]
