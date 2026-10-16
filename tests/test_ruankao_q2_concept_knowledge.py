"""Acceptance tests for T7: question-2 concept knowledge resolution.

render_question_q2_points resolves concept knowledge first from the
ruankao_concept_cache, falls back to web_search on a miss and writes the
gathered knowledge back to the cache. The verified knowledge is injected
into the prompt through the `note` whitelist variable only — per ADR-017 no
model-essay data may enter the prompt context.

No real network: web_search is mocked at
open_notebook.ai.ruankao_question_pipeline.web_search; DB access is mocked
at open_notebook.database.repository.repo_query /
open_notebook.domain.base.repo_create.
"""

from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.ai import ruankao_question_pipeline as pipeline
from open_notebook.ai.ruankao_question_pipeline import (
    QuestionQ2Point,
    QuestionQ2PointsDraft,
)

REPO_QUERY = "open_notebook.database.repository.repo_query"
REPO_CREATE = "open_notebook.domain.base.repo_create"
WEB_SEARCH = "open_notebook.ai.ruankao_question_pipeline.web_search"
INVOKE_JSON = "open_notebook.ai.ruankao_question_pipeline._invoke_json"

# "论微服务架构的设计与实现" → strip 论 + 设计与实现 suffix → "微服务架构"
TITLE = "论微服务架构的设计与实现"
CONCEPT_KEY = "微服务架构"

WEB_RESULTS = [
    {
        "title": "微服务架构概述",
        "url": "https://kb.example/msa",
        "snippet": "微服务架构是将单一应用拆分为一组小服务的架构风格。",
    },
    {"title": "补充要点", "url": "https://kb.example/2", "snippet": "独立部署。"},
]


def _cache_row(**overrides) -> Dict[str, Any]:
    row = {
        "name": CONCEPT_KEY,
        "category": "系统架构设计师",
        "domain": None,
        "definition": "缓存里的概念定义",
        "key_points": ["要点一", "要点二"],
        "exam_focus": None,
        "source": "web:https://kb.example/msa",
    }
    row.update(overrides)
    return row


class TestResolveConceptKnowledge:
    @pytest.mark.asyncio
    async def test_should_use_cache_hit_without_web_search(self):
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[_cache_row()]),
            patch(WEB_SEARCH, new_callable=AsyncMock) as search,
            patch(REPO_CREATE, new_callable=AsyncMock) as create,
        ):
            text = await pipeline.resolve_concept_knowledge(TITLE, "问题二")

        assert "缓存里的概念定义" in text
        assert "要点一；要点二" in text
        search.assert_not_awaited()
        create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_search_web_and_write_cache_on_miss(self):
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[]),
            patch(
                WEB_SEARCH, new_callable=AsyncMock, return_value=WEB_RESULTS
            ) as search,
            patch(REPO_CREATE, new_callable=AsyncMock, return_value=[{}]) as create,
        ):
            text = await pipeline.resolve_concept_knowledge(TITLE, "问题二")

        assert text is not None
        assert "权威联网核验参考" in text
        assert "微服务架构是将单一应用拆分为一组小服务的架构风格。" in text
        search.assert_awaited_once()
        create.assert_awaited_once()
        table, data = create.await_args.args
        assert table == "ruankao_concept_cache"
        assert data["name"] == CONCEPT_KEY
        assert (
            data["definition"] == "微服务架构是将单一应用拆分为一组小服务的架构风格。"
        )
        assert data["source"] == "web:https://kb.example/msa"

    @pytest.mark.asyncio
    async def test_should_return_none_when_cache_and_web_both_fail(self):
        with (
            patch(
                REPO_QUERY, new_callable=AsyncMock, side_effect=RuntimeError("db down")
            ),
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=[]),
        ):
            assert await pipeline.resolve_concept_knowledge(TITLE, "问题二") is None

    @pytest.mark.asyncio
    async def test_should_return_none_when_web_search_raises(self):
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[]),
            patch(
                WEB_SEARCH,
                new_callable=AsyncMock,
                side_effect=RuntimeError("network down"),
            ),
        ):
            assert await pipeline.resolve_concept_knowledge(TITLE, "问题二") is None


class TestRenderQuestionQ2PointsInjection:
    """The verified concept reaches the prompt through the `note` whitelist
    variable only (ADR-017: no model-essay data, ever)."""

    def _fake_invoke(self, captured: Dict[str, Any]):
        async def fake_invoke(
            template,
            data,
            result_model,
            model_id,
            budget=None,
            validator=None,
            max_tokens=4096,
            on_delta=None,
            on_stage=None,
        ):
            captured.update(template=template, data=dict(data))
            return QuestionQ2PointsDraft(
                framework="分层展开",
                points=[QuestionQ2Point(heading="要点", detail="说明")],
                outline_hint="提纲提示",
            )

        return fake_invoke

    @pytest.mark.asyncio
    async def test_should_inject_verified_concept_through_note_variable_only(self):
        captured: Dict[str, Any] = {}
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[_cache_row()]),
            patch(WEB_SEARCH, new_callable=AsyncMock),
            patch(INVOKE_JSON, self._fake_invoke(captured)),
        ):
            result = await pipeline.render_question_q2_points(
                title=TITLE,
                year="2025",
                domain="系统架构设计师",
                q1="论题概述",
                q2="方法要点",
                q3="总结",
                note="考生自己的备注",
            )

        data = captured["data"]
        # 白名单：只有考试元数据 + note，任何检索/范文类变量都违规
        assert set(data) == {"title", "year", "domain", "q1", "q2", "q3", "note"}
        assert "考生自己的备注" in data["note"]
        assert "权威概念规范与要点" in data["note"]
        assert "缓存里的概念定义" in data["note"]
        assert "model_essay" not in repr(data).lower()
        assert result["framework"] == "分层展开"

    @pytest.mark.asyncio
    async def test_should_keep_note_untouched_when_concept_unresolved(self):
        captured: Dict[str, Any] = {}
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[]),
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=[]),
            patch(INVOKE_JSON, self._fake_invoke(captured)),
        ):
            await pipeline.render_question_q2_points(
                title=TITLE, year="2025", domain="系统架构设计师", note="考生备注"
            )

        assert captured["data"]["note"] == "考生备注"

    @pytest.mark.asyncio
    async def test_should_still_render_when_concept_lookup_raises(self):
        captured: Dict[str, Any] = {}
        with (
            patch(
                REPO_QUERY, new_callable=AsyncMock, side_effect=RuntimeError("db down")
            ),
            patch(
                WEB_SEARCH,
                new_callable=AsyncMock,
                side_effect=RuntimeError("network down"),
            ),
            patch(INVOKE_JSON, self._fake_invoke(captured)),
        ):
            result = await pipeline.render_question_q2_points(
                title=TITLE, year="2025", domain="系统架构设计师"
            )

        assert result["framework"] == "分层展开"
        assert captured["data"]["note"] == ""
