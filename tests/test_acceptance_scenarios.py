"""User acceptance scenarios S1-S10 that lacked an exact test.

Only the gaps found while mapping the scenarios onto the existing suite:
S1 rdStatus, S2 year-2023 exact cases, S4 versioned era-specific techs,
S5 the retired "no local evidence -> fail" rule, S8 empty period_start,
S9 "20.0"-style versions. Everything else is already covered elsewhere
(see the mapping table in the verification report).
"""

from unittest.mock import AsyncMock, patch

import pytest
from ai_prompter import Prompter

from open_notebook.ai.project_env_pipeline import (
    extract_claims_regex,
    prescreen_point_anchors,
    prescreen_quote,
)
from open_notebook.domain.project_env_rules import (
    GA_ANCHORS,
    check_ga_ordering,
    is_valid_tech_name,
    lookup_ga_month,
)

RESOLVE_GA = "open_notebook.ai.project_env_pipeline.resolve_ga_anchor"
WEB_SEARCH = "open_notebook.ai.project_env_pipeline.web_search"


# ==============================================================================
# S1: 业务字段（rdStatus 等）不进技术核验
# ==============================================================================


def test_should_reject_rd_status_business_field_as_tech_name():
    assert is_valid_tech_name("rdStatus") is False


def test_should_filter_rd_status_out_of_extraction_and_prescreen():
    text = "系统按 rdStatus 1.0 判断重试级别。"
    claims = extract_claims_regex({"background": text})
    assert not any(c["type"] == "version" for c in claims)
    assert prescreen_quote(text, "2025.01")["status"] == "unspecified"


# ==============================================================================
# S2: 2023 年项目写未标版本的成熟技术 → 放行，不逼问版本号
# ==============================================================================


@pytest.mark.parametrize("tech", ["Oracle Data Guard", "MongoDB"])
def test_should_pass_mature_techs_without_version_in_2023_project(tech):
    result = check_ga_ordering(tech, None, "2023.06")
    assert result["status"] == "unspecified"
    assert not result.get("message")


@pytest.mark.asyncio
async def test_should_prescreen_mature_techs_without_version_in_2023_project():
    quote = "空间检索依托 MongoDB 空间索引实现，核心容灾采用 Oracle Data Guard。"
    with patch(WEB_SEARCH, new_callable=AsyncMock) as mock_search:
        result = await prescreen_point_anchors(quote, "2023.06")

    mock_search.assert_not_awaited()
    assert result["status"] == "unspecified"
    assert result["message"] == ""


# ==============================================================================
# S4: 时代专属技术（Qwen 2.5 / DeepSeek）只在穿越时 fail
# ==============================================================================


@pytest.mark.parametrize("period_start", ["2022.06", "2023.06"])
def test_should_fail_qwen_2_5_in_pre_era_projects(period_start):
    result = check_ga_ordering("Qwen", "2.5", period_start)
    assert result["status"] == "fail"
    assert "时代专属性新技术" in result["message"]


@pytest.mark.parametrize("period_start", ["2022.06", "2023.06"])
def test_should_fail_deepseek_in_pre_era_projects(period_start):
    result = check_ga_ordering("DeepSeek", None, period_start)
    assert result["status"] == "fail"
    assert "时代专属性新技术" in result["message"]


def test_should_pass_qwen_2_5_in_2024_project_after_ga():
    # Qwen 2.5 GA 2024.09: a 2024.10 project start no longer trips the era rule
    result = check_ga_ordering("Qwen", "2.5", "2024.10")
    assert result["status"] == "pass"


def test_should_leave_deepseek_unspecified_in_2024_project_without_version():
    result = check_ga_ordering("DeepSeek", None, "2024.01")
    assert result["status"] == "unspecified"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "period_start,expected",
    [("2023.06", "fail"), ("2024.10", "pass")],
)
async def test_should_judge_qwen_2_5_by_project_year_in_prescreen(
    period_start, expected
):
    result = await prescreen_point_anchors(
        "模型推理服务采用 Qwen 2.5 部署。", period_start
    )
    assert result["status"] == expected


# ==============================================================================
# S5: verify_a 规则区不得回潮"本地无证据 → fail"旧逻辑
# ==============================================================================


def test_verify_a_rules_keep_private_facts_pass_without_local_evidence():
    rendered = Prompter(prompt_template="project_env/verify_a").render(
        data={
            "quote": "单次空间相交查询平均响应时间控制在 10ms 以内",
            "field": "tuning_process",
            "evidence": "(本地知识库中未检索到相关材料)",
            "anchor_table": "(空)",
        }
    )
    rules = rendered.split("# VERDICT RULES", 1)[1]

    assert 'they must DEFAULT TO "pass"' in rules
    assert "NEVER fail or interrogate private business claims" in rules
    # 旧逻辑（证据未检索到即判 fail）不得再出现在规则区
    assert "无证据支持" not in rules
    assert "not supported by evidence" not in rules
    assert "unsupported by evidence" not in rules


# ==============================================================================
# S8: period_start 为空串时 prescreen_point_anchors 不抛 ValueError
# ==============================================================================


@pytest.mark.asyncio
async def test_should_not_raise_when_period_start_is_empty_string():
    with patch(RESOLVE_GA, new_callable=AsyncMock, return_value=None):
        result = await prescreen_point_anchors("数据库采用 MySQL 8.4 主从。", "")

    assert result["status"] == "unknown"


@pytest.mark.asyncio
async def test_should_not_raise_when_period_start_empty_and_anchor_resolves():
    anchor = {
        "ga": "2025.06",
        "source": "web:https://example.com/mysql",
        "confidence": "web",
    }
    with patch(RESOLVE_GA, new_callable=AsyncMock, return_value=anchor):
        result = await prescreen_point_anchors("数据库采用 MySQL 8.4 主从。", "")

    assert result["status"] == "unknown"
    assert result["anchors"]["mysql 8.4"]["ga"] == "2025.06"


# ==============================================================================
# S9: "20.0" 类版本号查表不得被截断成 "2"
# ==============================================================================


def test_should_not_truncate_node_20_0_in_lookup_ga_month():
    assert lookup_ga_month(GA_ANCHORS["node"], "20.0") == "2023.04"
    assert lookup_ga_month(GA_ANCHORS["node"], "18.0") == "2022.04"
    assert lookup_ga_month(GA_ANCHORS["node"], "2.0") is None


def test_should_fail_node_20_0_in_2022_project_in_check_ga_ordering():
    result = check_ga_ordering("Node", "20.0", "2022.01")
    assert result["status"] == "fail"
    assert result["ga"] == "2023.04"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "period_start,expected",
    [("2022.01", "fail"), ("2023.04", "pass")],
)
async def test_should_resolve_node_20_0_anchor_in_prescreen(period_start, expected):
    result = await prescreen_point_anchors(
        "前端工具链采用 Node 20.0 构建。", period_start
    )
    assert result["status"] == expected
