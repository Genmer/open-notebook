"""API tests for POST /api/project-envs/prd-parse (PRD 导入解析).

All IO and LLM seams are patched: extract_content (content-core) and
parse_prd_draft (pipeline). The endpoint is stateless — nothing persists,
the temp file is deleted after extraction even on failure.
"""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import content_core as cc
from fastapi.testclient import TestClient

from open_notebook.ai.project_env_pipeline import PrdParseDraft


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _parsed(**overrides) -> PrdParseDraft:
    data = dict(
        name="物流 TMS 运输管理系统",
        period_start="2025.02",
        period_end="2025.09",
        industry="物流行业",
        keywords=["TMS", "物流"],
        background="为物流企业建设运输管理系统。",
        tech_background="采用 Spring Boot 3.2 微服务架构。",
        tuning_process="上线后针对慢查询做了调优。",
        problems_solutions="解决了路线规划超时问题。",
        my_role="我担任项目负责人。",
    )
    data.update(overrides)
    return PrdParseDraft(**data)


def _extracted(content: str):
    return SimpleNamespace(content=content)


# --- 422 reason family（全部在任何磁盘 IO / LLM 之前判定） ---


def test_missing_input_422():
    with patch("api.routers.project_envs.parse_prd_draft") as parse:
        response = _client().post("/api/project-envs/prd-parse")
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "missing_input"
    parse.assert_not_awaited()


def test_both_inputs_422():
    with patch("api.routers.project_envs.parse_prd_draft") as parse:
        response = _client().post(
            "/api/project-envs/prd-parse",
            data={"text": "PRD 文本"},
            files={"file": ("a.txt", b"PRD bytes", "text/plain")},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "both_inputs"
    parse.assert_not_awaited()


def test_unsupported_type_422():
    with patch("api.routers.project_envs.parse_prd_draft") as parse:
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "unsupported_type"
    parse.assert_not_awaited()


def test_file_too_large_422():
    big = b"\0" * (10 * 1024 * 1024 + 1)
    with patch("api.routers.project_envs.parse_prd_draft") as parse:
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("big.pdf", big, "application/pdf")},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "file_too_large"
    parse.assert_not_awaited()


def test_file_too_large_rejected_before_any_extraction_io():
    """10MB 判定在读到上传内容后、任何抽取 IO / LLM 之前：不写临时文件不抽取。"""
    big = b"\0" * (10 * 1024 * 1024 + 1)
    with (
        patch(
            "api.routers.project_envs.extract_content", new_callable=AsyncMock
        ) as extract,
        patch("api.routers.project_envs.parse_prd_draft") as parse,
    ):
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("big.pdf", big, "application/pdf")},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "file_too_large"
    extract.assert_not_awaited()
    parse.assert_not_awaited()


def test_file_at_exactly_10mb_passes_size_gate():
    """边界：恰好 10MB（判定用 >）不触发 file_too_large，继续走抽取。"""
    exact = b"\0" * (10 * 1024 * 1024)
    with (
        patch(
            "api.routers.project_envs.extract_content",
            new_callable=AsyncMock,
            return_value=_extracted("字" * 90_000),
        ),
        patch(
            "api.routers.project_envs.parse_prd_draft",
            new_callable=AsyncMock,
            return_value=_parsed(),
        ) as parse,
    ):
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("edge.pdf", exact, "application/pdf")},
        )
    assert response.status_code == 200
    assert response.json()["input_truncated"] is True
    assert response.json()["extracted_chars"] == 90_000
    call = parse.await_args
    assert call is not None
    assert len(call.args[0]) == 80_000


def test_text_too_long_422():
    with patch("api.routers.project_envs.parse_prd_draft") as parse:
        response = _client().post(
            "/api/project-envs/prd-parse", data={"text": "字" * 100_001}
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "text_too_long"
    parse.assert_not_awaited()


def test_extraction_empty_422():
    with (
        patch(
            "api.routers.project_envs.extract_content",
            new_callable=AsyncMock,
            return_value=_extracted("   "),
        ),
        patch("api.routers.project_envs.parse_prd_draft") as parse,
    ):
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("scan.pdf", b"%PDF", "application/pdf")},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "extraction_empty"
    assert "docx" in response.json()["detail"]["message"]
    parse.assert_not_awaited()


def test_extraction_failed_422():
    with patch(
        "api.routers.project_envs.extract_content",
        new_callable=AsyncMock,
        side_effect=cc.ContentCoreError("engine died"),
    ):
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("a.docx", b"PK", "application/vnd...")},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "extraction_failed"


# --- 502 / 504 ---


def test_model_error_502():
    with patch(
        "api.routers.project_envs.parse_prd_draft",
        new_callable=AsyncMock,
        return_value=None,
    ):
        response = _client().post("/api/project-envs/prd-parse", data={"text": "PRD"})
    assert response.status_code == 502
    assert response.json()["detail"]["reason"] == "model_error"


def test_model_timeout_504():
    async def slow(_text):
        await asyncio.sleep(5)
        return _parsed()

    with (
        patch("api.routers.project_envs.parse_prd_draft", side_effect=slow),
        patch("api.routers.project_envs.PRD_PARSE_TIMEOUT_SECONDS", 0.05),
    ):
        response = _client().post("/api/project-envs/prd-parse", data={"text": "PRD"})
    assert response.status_code == 504
    assert response.json()["detail"]["reason"] == "model_timeout"


# --- 成功路径：omitted / truncated / 硬化 ---


def test_success_text_omitted_derived_from_empty_values():
    parsed = _parsed(
        period_start="", period_end="", industry="", keywords=[], my_role=""
    )
    with patch(
        "api.routers.project_envs.parse_prd_draft",
        new_callable=AsyncMock,
        return_value=parsed,
    ):
        response = _client().post("/api/project-envs/prd-parse", data={"text": "PRD"})
    assert response.status_code == 200
    body = response.json()
    assert body["omitted"] == [
        "period_start",
        "period_end",
        "industry",
        "keywords",
        "my_role",
    ]
    assert body["input_truncated"] is False
    assert body["extracted_chars"] == len("PRD")


def test_success_truncated_head_only():
    prd = "字" * 80_001
    with patch(
        "api.routers.project_envs.parse_prd_draft",
        new_callable=AsyncMock,
        return_value=_parsed(),
    ) as parse:
        response = _client().post("/api/project-envs/prd-parse", data={"text": prd})
    assert response.status_code == 200
    body = response.json()
    assert body["input_truncated"] is True
    assert body["extracted_chars"] == 80_001
    # LLM 只收到头部截断后的 8 万字符
    call = parse.await_args
    assert call is not None
    assert len(call.args[0]) == 80_000


def test_success_hardens_untrusted_llm_output():
    parsed = _parsed(
        name="名" * 150,
        industry="行" * 30,
        period_start="2025-02",
        period_end="2025.09",
        keywords=["TMS", "  ", "TMS", "物流", "调度", "在途", "回单", "结算", "超载"],
        background="  带空白的背景。  ",
    )
    with patch(
        "api.routers.project_envs.parse_prd_draft",
        new_callable=AsyncMock,
        return_value=parsed,
    ):
        response = _client().post("/api/project-envs/prd-parse", data={"text": "PRD"})
    assert response.status_code == 200
    draft = response.json()["draft"]
    assert len(draft["name"]) == 100
    assert len(draft["industry"]) == 20
    assert draft["period_start"] == ""  # 不匹配 MONTH_RE 置空
    assert draft["period_end"] == "2025.09"
    assert draft["keywords"] == ["TMS", "物流", "调度", "在途", "回单", "结算", "超载"]
    assert draft["background"] == "带空白的背景。"
    assert "period_start" in response.json()["omitted"]


def test_success_text_path_never_touches_content_core():
    """分流契约：粘贴文本路径完全不经过 content-core（无临时文件、无抽取）。"""
    with (
        patch(
            "api.routers.project_envs.extract_content", new_callable=AsyncMock
        ) as extract,
        patch(
            "api.routers.project_envs.parse_prd_draft",
            new_callable=AsyncMock,
            return_value=_parsed(),
        ),
    ):
        response = _client().post("/api/project-envs/prd-parse", data={"text": "PRD"})
    assert response.status_code == 200
    extract.assert_not_awaited()


def test_success_file_flow_extracts_and_deletes_temp_file():
    seen_paths: list = []

    async def fake_extract(**kwargs):
        path = kwargs["file_path"]
        seen_paths.append(path)
        assert os.path.exists(path)  # 抽取时临时文件在位
        assert path.endswith(".pdf")
        return _extracted("从 PDF 提取的 PRD 文本。")

    with (
        patch("api.routers.project_envs.extract_content", side_effect=fake_extract),
        patch(
            "api.routers.project_envs.parse_prd_draft",
            new_callable=AsyncMock,
            return_value=_parsed(),
        ) as parse,
    ):
        response = _client().post(
            "/api/project-envs/prd-parse",
            files={"file": ("需求文档.pdf", b"%PDF-1.4", "application/pdf")},
        )
    assert response.status_code == 200
    assert response.json()["extracted_chars"] == len("从 PDF 提取的 PRD 文本。")
    # LLM 收到的是抽取文本而非粘贴文本
    call = parse.await_args
    assert call is not None
    assert call.args[0] == "从 PDF 提取的 PRD 文本。"
    # 请求结束后临时文件已删除
    assert seen_paths and not os.path.exists(seen_paths[0])
