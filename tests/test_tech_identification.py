"""Tests for technology identification and business variable filtering (T1)."""

import pytest

from open_notebook.domain.project_env_rules import (
    ERA_SPECIFIC_TECHS,
    INVALID_TECH_SUFFIX_PATTERN,
    KNOWN_TECHS,
    check_ga_ordering,
    is_valid_tech_name,
)


def test_known_and_era_specific_techs_defined():
    assert "python" in KNOWN_TECHS
    assert "qwen" in ERA_SPECIFIC_TECHS
    assert "deepseek" in ERA_SPECIFIC_TECHS


@pytest.mark.parametrize(
    "name",
    [
        "siteId",
        "districtCode",
        "areaType",
        "userStatus",
        "totalNum",
        "isFlag",
        "dataList",
        "ruleMap",
        "secretKey",
        "userName",
        "createTime",
        "orderDate",
        "paramVal",
        "itemValue",
        "retryCount",
        "pageIndex",
        "orderNo",
        "roleDesc",
        "serverInfo",
        "id",
        "code",
        "type",
        "status",
        "site_id",
        "district_code",
        "order_no",
        "orderId",
        "userId",
        "deptCode",
    ],
)
def test_business_fields_classified_as_invalid(name: str):
    assert not is_valid_tech_name(name)
    assert INVALID_TECH_SUFFIX_PATTERN.search(name)


@pytest.mark.parametrize(
    "name",
    [
        "Python",
        "Java",
        "Go",
        "Spring Boot",
        "MySQL",
        "PostgreSQL",
        "Redis",
        "Kafka",
        "RabbitMQ",
        "Kubernetes",
        "Docker",
        "Elasticsearch",
        "ClickHouse",
        "Nginx",
        "Vue",
        "React",
        "PyTorch",
        "Qwen",
        "LLaMA",
        "vLLM",
        "Milvus",
        "Flink",
        "MongoDB",
        "Oracle Data Guard",
        "RocketMQ",
        "Canal",
        "Dubbo",
        "Nacos",
        "Sentinel",
        "Seata",
        "TiDB",
        "Dameng",
        "Rust",
        "FastAPI",
    ],
)
def test_valid_technologies_classified_as_true(name: str):
    assert is_valid_tech_name(name)


@pytest.mark.parametrize(
    "invalid_input",
    [
        "",
        "   ",
        "123",
        "4.5",
        "，系统",
        "。",
        "invalid;tech",
        "tech\nname",
    ],
)
def test_malformed_inputs_classified_as_false(invalid_input):
    assert not is_valid_tech_name(invalid_input)


def test_business_variable_prescreen_returns_unspecified():
    result = check_ga_ordering("siteId", "1.0", "2025.01")
    assert result["status"] == "unspecified"


def test_era_specific_tech_without_version_violates_early_start():
    # Qwen emerged in 2023.08; project start in 2021.01 should fail
    result = check_ga_ordering("Qwen", None, "2021.01")
    assert result["status"] == "fail"
    assert "时代专属性新技术" in result["message"]


def test_era_specific_tech_without_version_passes_recent_start():
    # Qwen in a project starting in 2024.01 should not fail on era check
    result = check_ga_ordering("Qwen", None, "2024.01")
    assert result["status"] == "unspecified"


def test_mature_tech_without_version_passes_without_version_quibble():
    # Oracle Data Guard has no era restriction; without version it stays unspecified (not fail)
    result = check_ga_ordering("Oracle Data Guard", None, "2021.01")
    assert result["status"] == "unspecified"


def test_extract_claims_regex_ignores_business_variables():
    from open_notebook.ai.project_env_pipeline import extract_claims_regex

    claims = extract_claims_regex(
        {"background": "系统根据 siteId 1.0 进行分片，配合 districtCode 2.0 寻址。"}
    )
    assert not any(c["type"] == "version" for c in claims)


def test_extract_claims_regex_captures_real_tech_version():
    from open_notebook.ai.project_env_pipeline import extract_claims_regex

    claims = extract_claims_regex(
        {"background": "底座采用 Redis 7.0 缓存并依赖 MySQL 8.0 持久化。"}
    )
    assert any(c["type"] == "version" for c in claims)


@pytest.mark.asyncio
async def test_anchors_table_for_ignores_business_variables():
    from open_notebook.ai.project_env_pipeline import anchors_table_for

    table = await anchors_table_for("系统按 siteId 1.0 路由，按 areaType 2.0 分组。")
    assert "siteId" not in table
    assert "areaType" not in table


@pytest.mark.asyncio
async def test_prescreen_point_anchors_ignores_business_variables():
    from open_notebook.ai.project_env_pipeline import prescreen_point_anchors

    result = await prescreen_point_anchors("系统根据 siteId 1.0 路由。", "2025.01")
    assert result["status"] == "unspecified"
