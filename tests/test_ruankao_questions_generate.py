"""API tests for the question-workbench generation endpoint (G 线 生成工作台).

Mirrors the fixed-parts endpoint tests (test_project_env_fixed_parts.py):
the only seam is the pipeline render function imported by the router — the
endpoint is fully stateless, so A6 asserts ZERO persistence calls (no
repo_query, and the router module does not even import a repository /
model binding).

Red line (ADR-017): the request body carries ONLY exam metadata (title /
year / domain / three prompts) plus the candidate's note; A8 pins the
prompt-template red-line clauses against deletion.
"""

import asyncio
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _request(**overrides) -> dict:
    data = {
        "kind": "breakdown",
        "title": "论负载均衡技术的应用",
        "year": "2024 上",
        "domain": "微服务与分布式",
        "prompts": {
            "q1": "1.概要叙述你参与管理和开发的软件项目…",
            "q2": "2.具体论述你负载均衡的技术组成…",
            "q3": "3.通过你的切身实践谈谈效果…",
        },
        "note": "",
    }
    data.update(overrides)
    return data


BREAKDOWN_PAYLOAD = {
    "angles": [
        {
            "name": f"候选论点角度{i}",
            "thesis_hint": "主旨候选句方向（一句）",
            "material_match": "高：有量化指标的项目素材容易支撑",
            "difficulty": "medium",
            "similarity_risk": "low",
        }
        for i in range(4)
    ],
    "combo_advice": "建议选角度0与角度1，与摘要和背景呼应",
}

Q2_POINTS_PAYLOAD = {
    "framework": "总-分-总技术方法论述框架",
    "points": [
        {"heading": f"要点{i}", "detail": "展开说明与常引用口径"} for i in range(3)
    ],
    "outline_hint": "按要点顺序组织，正文必须考生自己写",
}

OUTLINE_PAYLOAD = {
    "paragraphs": [
        {
            "role": "q2",
            "outline": "主旨候选句 + 分层展开顺序（条目式）",
            "data_anchors": ["扩容前后的 QPS 对比"],
        },
        {
            "role": "q3",
            "outline": "主旨候选句 + 实施与效果展开（条目式）",
            "data_anchors": ["故障恢复时长"],
        },
    ],
}

_RENDER_FUNCS = {
    "breakdown": "render_question_breakdown",
    "q2_points": "render_question_q2_points",
    "outline": "render_question_outline",
}

_PAYLOADS = {
    "breakdown": BREAKDOWN_PAYLOAD,
    "q2_points": Q2_POINTS_PAYLOAD,
    "outline": OUTLINE_PAYLOAD,
}


def test_generate_breakdown_success_is_stateless_and_passes_metadata():
    client = _client()
    request = _request(note="往云原生方向拆，避开纯算法对比")
    with (
        patch(
            "api.routers.ruankao_questions.render_question_breakdown",
            new_callable=AsyncMock,
            return_value=BREAKDOWN_PAYLOAD,
        ) as mock_render,
        patch(
            "open_notebook.database.repository.repo_query",
            new_callable=AsyncMock,
        ) as mock_repo_query,
    ):
        response = client.post("/api/ruankao/questions/generate", json=request)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "breakdown"
    assert 4 <= len(body["angles"]) <= 6
    for angle in body["angles"]:
        assert set(angle) == {
            "name",
            "thesis_hint",
            "material_match",
            "difficulty",
            "similarity_risk",
        }
    assert body["combo_advice"] == BREAKDOWN_PAYLOAD["combo_advice"]

    # 考试元数据 + 备注 逐字透传给渲染函数（红线：上下文只有这五项 + note）
    assert mock_render.await_args is not None
    kwargs = mock_render.await_args.kwargs
    assert kwargs["title"] == "论负载均衡技术的应用"
    assert kwargs["year"] == "2024 上"
    assert kwargs["domain"] == "微服务与分布式"
    assert kwargs["q1"] == request["prompts"]["q1"]
    assert kwargs["q2"] == request["prompts"]["q2"]
    assert kwargs["q3"] == request["prompts"]["q3"]
    assert kwargs["note"] == "往云原生方向拆，避开纯算法对比"

    # A6 无状态断言（强于 fixed-parts 先例）：成功路径零 repo_query，且路由
    # 模块根本没有导入任何持久化绑定——范文在构造上不可达。
    mock_repo_query.assert_not_called()
    import api.routers.ruankao_questions as ruankao_questions

    assert not hasattr(ruankao_questions, "repo_query")
    assert not hasattr(ruankao_questions, "ProjectEnv")
    assert not hasattr(ruankao_questions, "Source")


def test_generate_q2_points_success_shape():
    client = _client()
    with patch(
        "api.routers.ruankao_questions.render_question_q2_points",
        new_callable=AsyncMock,
        return_value=Q2_POINTS_PAYLOAD,
    ):
        response = client.post(
            "/api/ruankao/questions/generate",
            json=_request(kind="q2_points"),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "q2_points"
    assert body["framework"] == Q2_POINTS_PAYLOAD["framework"]
    assert 3 <= len(body["points"]) <= 5
    for point in body["points"]:
        assert set(point) == {"heading", "detail"}
    assert body["outline_hint"] == Q2_POINTS_PAYLOAD["outline_hint"]


def test_generate_outline_success_shape():
    client = _client()
    with patch(
        "api.routers.ruankao_questions.render_question_outline",
        new_callable=AsyncMock,
        return_value=OUTLINE_PAYLOAD,
    ):
        response = client.post(
            "/api/ruankao/questions/generate",
            json=_request(kind="outline"),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "outline"
    assert len(body["paragraphs"]) == 2
    assert {p["role"] for p in body["paragraphs"]} == {"q2", "q3"}
    for paragraph in body["paragraphs"]:
        assert set(paragraph) == {"role", "outline", "data_anchors"}
        assert isinstance(paragraph["data_anchors"], list)


def test_generate_requires_title():
    client = _client()
    # 空 / 纯空白 / 字段缺失 → 统一 422 no_title（设计稿 1.2.1 口径）
    cases = [_request(title=""), _request(title="   "), {"kind": "breakdown"}]
    for body in cases:
        with patch(
            "api.routers.ruankao_questions.render_question_breakdown",
            new_callable=AsyncMock,
        ) as mock_render:
            response = client.post("/api/ruankao/questions/generate", json=body)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["reason"] == "no_title"
        mock_render.assert_not_awaited()


def test_generate_rejects_unknown_kind():
    client = _client()
    response = client.post(
        "/api/ruankao/questions/generate",
        json=_request(kind="essay"),
    )
    assert response.status_code == 422


def test_generate_unusable_output_returns_502():
    client = _client()
    with patch(
        "api.routers.ruankao_questions.render_question_outline",
        new_callable=AsyncMock,
        side_effect=ValueError("outline returned unusable output"),
    ):
        response = client.post(
            "/api/ruankao/questions/generate",
            json=_request(kind="outline"),
        )
    assert response.status_code == 502
    assert response.json()["detail"]["reason"] == "model_error"


def test_generate_timeout_returns_504():
    client = _client()
    with patch(
        "api.routers.ruankao_questions.render_question_q2_points",
        new_callable=AsyncMock,
        side_effect=asyncio.TimeoutError(),
    ):
        response = client.post(
            "/api/ruankao/questions/generate",
            json=_request(kind="q2_points"),
        )
    assert response.status_code == 504
    assert response.json()["detail"]["reason"] == "model_timeout"


@pytest.mark.parametrize("kind", ["breakdown", "q2_points", "outline"])
def test_generate_passes_note_verbatim_for_every_kind(kind):
    client = _client()
    note = "  二段式结构，第二段写故障演练，别写死数字  "
    with patch(
        f"api.routers.ruankao_questions.{_RENDER_FUNCS[kind]}",
        new_callable=AsyncMock,
        return_value=_PAYLOADS[kind],
    ) as mock_render:
        response = client.post(
            "/api/ruankao/questions/generate",
            json=_request(kind=kind, note=note),
        )
    assert response.status_code == 200, response.text
    assert mock_render.await_args is not None
    assert mock_render.await_args.kwargs["note"] == note


# --- A8: prompt templates exist and carry the red-line clauses ---

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts" / "ruankao"

# 模板变量白名单（红线 1.3）：五项考试元数据 + format_instructions，
# 多一个检索/笔记本/范文类变量即违规。
TEMPLATE_ALLOWED_VARS = {
    "title",
    "year",
    "domain",
    "q1",
    "q2",
    "q3",
    "note",
    "format_instructions",
}


def _template_variables(content: str) -> set:
    variables: set = set()
    for match in re.finditer(
        r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|[^}]*)?}}", content
    ):
        variables.add(match.group(1))
    for match in re.finditer(r"{%\s*(?:if|elif)\s+([A-Za-z_][A-Za-z0-9_]*)", content):
        variables.add(match.group(1))
    return variables


@pytest.mark.parametrize(
    "template_name",
    ["question_breakdown", "question_q2_points", "question_outline"],
)
def test_template_red_line_clauses(template_name: str):
    path = PROMPTS_DIR / f"{template_name}.jinja"
    assert path.is_file(), f"missing template: {path}"
    content = path.read_text(encoding="utf-8")

    # 红线条款（设计稿 1.3，测试防删）：无检索 / 范文不可复述 /
    # 考生自己定稿 / JSON-only 输出。
    assert "NO retrieval" in content
    assert "范文" in content
    assert "model essay" in content
    assert "考生自己" in content
    assert "Output ONLY the JSON object" in content

    # 上下文白名单：模板变量不许出现检索/笔记本/范文类变量
    extra = _template_variables(content) - TEMPLATE_ALLOWED_VARS
    assert extra == set(), f"template {template_name} has off-whitelist vars: {extra}"


# --- SSE stream twin: POST /api/ruankao/questions/generate/stream ---

import json as _json


def _parse_sse(text: str) -> list:
    """Collect every `data: {...}` event payload from a raw SSE body."""
    events = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(_json.loads(line[len("data: ") :]))
    return events


def test_stream_success_emits_deltas_then_complete():
    """Delta events carry raw LLM chunks; the complete event's result field
    is byte-identical to the sync endpoint's response shape."""
    client = _client()

    # on_stage=None：路由现在总会传 on_stage，fake 必须接住（不消费即无后续 stage 事件）
    async def fake_render(
        title, year, domain, q1, q2, q3, note, on_delta=None, on_stage=None
    ):
        if on_delta:
            on_delta('{"angles": [')
            on_delta(" …片段… ]}")
        return BREAKDOWN_PAYLOAD

    with (
        patch(
            "api.routers.ruankao_questions.render_question_breakdown",
            new_callable=AsyncMock,
            side_effect=fake_render,
        ),
        patch(
            "open_notebook.database.repository.repo_query",
            new_callable=AsyncMock,
        ) as mock_repo_query,
    ):
        with client.stream(
            "POST", "/api/ruankao/questions/generate/stream", json=_request()
        ) as response:
            assert response.status_code == 200
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    deltas = [e for e in events if e["type"] == "delta"]
    completes = [e for e in events if e["type"] == "complete"]
    assert [d["content"] for d in deltas] == ['{"angles": [', " …片段… ]}"]
    assert len(completes) == 1
    result = completes[0]["result"]
    assert result["kind"] == "breakdown"
    assert result["combo_advice"] == BREAKDOWN_PAYLOAD["combo_advice"]
    assert 4 <= len(result["angles"]) <= 6
    # A6 无状态：流式路径同样零 repo_query
    mock_repo_query.assert_not_called()


def test_stream_model_failure_emits_single_error_event():
    client = _client()
    with patch(
        "api.routers.ruankao_questions.render_question_outline",
        new_callable=AsyncMock,
        side_effect=ValueError("outline returned unusable output"),
    ):
        with client.stream(
            "POST",
            "/api/ruankao/questions/generate/stream",
            json=_request(kind="outline"),
        ) as response:
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    # 流一开始无条件发一条 stage(preparing)；error 事件形状与语义不变
    assert [e["type"] for e in events] == ["stage", "error"]
    assert events[0]["stage"] == "preparing"
    assert events[1]["reason"] == "model_error"


def test_stream_timeout_emits_model_timeout_error_event():
    client = _client()
    with patch(
        "api.routers.ruankao_questions.render_question_q2_points",
        new_callable=AsyncMock,
        side_effect=asyncio.TimeoutError(),
    ):
        with client.stream(
            "POST",
            "/api/ruankao/questions/generate/stream",
            json=_request(kind="q2_points"),
        ) as response:
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    # 流一开始无条件发一条 stage(preparing)；error 事件形状与语义不变
    assert [e["type"] for e in events] == ["stage", "error"]
    assert events[0]["stage"] == "preparing"
    assert events[1]["reason"] == "model_timeout"


def test_stream_requires_title_before_stream_starts():
    """空标题在流开始前就 422（普通 JSON 错误，不是 SSE error 事件）。"""
    client = _client()
    response = client.post(
        "/api/ruankao/questions/generate/stream", json=_request(title="  ")
    )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "no_title"


def test_stream_stage_events_appear_in_order():
    """on_stage 回调经 SSE 透传为 stage 事件，FIFO 保序：流首 preparing（
    首个 yield 前入队）→ waiting（排队/节流）→ thinking（首 chunk 未出文本）
    → generating（首个文本 delta），与 delta 的交错位置也按序不乱。"""
    client = _client()

    async def fake_render(
        title, year, domain, q1, q2, q3, note, on_delta=None, on_stage=None
    ):
        if on_stage:
            on_stage("waiting")
            on_stage("thinking")
        if on_delta:
            on_delta('{"angles": [')
        if on_stage:
            on_stage("generating")
        if on_delta:
            on_delta(" …片段… ]}")
        return BREAKDOWN_PAYLOAD

    with patch(
        "api.routers.ruankao_questions.render_question_breakdown",
        new_callable=AsyncMock,
        side_effect=fake_render,
    ):
        with client.stream(
            "POST", "/api/ruankao/questions/generate/stream", json=_request()
        ) as response:
            assert response.status_code == 200
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    assert [e["type"] for e in events] == [
        "stage",
        "stage",
        "stage",
        "delta",
        "stage",
        "delta",
        "complete",
    ]
    assert [e["stage"] for e in events if e["type"] == "stage"] == [
        "preparing",
        "waiting",
        "thinking",
        "generating",
    ]
    # delta / complete 形状与语义不变
    assert [e["content"] for e in events if e["type"] == "delta"] == [
        '{"angles": [',
        " …片段… ]}",
    ]
    assert events[-1]["result"]["kind"] == "breakdown"


def test_stream_without_on_stage_consumption_keeps_plain_event_flow():
    """渲染函数不消费 on_stage 时，流上只有流首一条 preparing stage 事件，
    其后仍是原样的 delta → complete——既有事件路径形状不动的最小证明。"""
    client = _client()

    async def fake_render(
        title, year, domain, q1, q2, q3, note, on_delta=None, on_stage=None
    ):
        if on_delta:
            on_delta('{"angles": [')
            on_delta(" …片段… ]}")
        return BREAKDOWN_PAYLOAD

    with patch(
        "api.routers.ruankao_questions.render_question_breakdown",
        new_callable=AsyncMock,
        side_effect=fake_render,
    ):
        with client.stream(
            "POST", "/api/ruankao/questions/generate/stream", json=_request()
        ) as response:
            assert response.status_code == 200
            body = "".join(chunk for chunk in response.iter_text())

    events = _parse_sse(body)
    assert [e["type"] for e in events] == ["stage", "delta", "delta", "complete"]
    assert events[0]["stage"] == "preparing"
