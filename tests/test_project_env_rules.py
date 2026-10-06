"""Table-driven tests for open_notebook/domain/project_env_rules.py."""

from datetime import datetime

import pytest

from open_notebook.domain.project_env_rules import (
    check_ga_ordering,
    check_runtime_consistency,
    complete_period,
    legal_window,
    mi,
    month_index,
    validate_period,
)

NOW = datetime(2026, 10, 15)


@pytest.mark.parametrize(
    "start,end,source_type,passed,rules",
    [
        ("2025.01", "2025.08", "real", True, []),
        ("2025.01", "2025.08", "mock", True, []),
        # R3: 2026.10 -> latest end 2025.09
        ("2025.02", "2025.09", "mock", True, []),
        ("2025.03", "2025.10", "mock", False, ["R3"]),
        ("2025.10", "2026.05", "mock", False, ["R3"]),
        # R2: strict 6-10
        ("2025.01", "2025.05", "mock", False, ["R2"]),
        ("2025.01", "2025.05", "real", False, ["R2"]),
        ("2024.10", "2025.08", "mock", False, ["R2"]),  # 11 months
        # R1 format
        ("2025-01", "2025.08", "real", False, ["R1"]),
        ("2025.1", "2025.08", "real", False, ["R1"]),
        ("2025.00", "2025.08", "real", False, ["R1"]),
        ("2025.13", "2025.08", "real", False, ["R1"]),
        ("2025/01", "2025/08", "real", False, ["R1"]),
        # R1 ordering
        ("2025.08", "2025.01", "real", False, ["R1"]),
    ],
)
def test_validate_period_table(start, end, source_type, passed, rules):
    result = validate_period(start, end, source_type, now=NOW)
    assert result["passed"] is passed
    assert [v["rule"] for v in result["violations"]] == rules


def test_r3_boundary_exactly_twelve_months_rejected():
    # end 2025.10 is exactly 12 months before 2026.10 -> rejected
    result = validate_period("2025.03", "2025.10", "mock", now=NOW)
    assert result["passed"] is False
    assert result["violations"][0]["rule"] == "R3"


def test_severity_split_real_warns_mock_blocks():
    real = validate_period("2025.01", "2025.05", "real", now=NOW)
    mock = validate_period("2025.01", "2025.05", "mock", now=NOW)
    assert real["violations"][0]["severity"] == "warn"
    assert mock["violations"][0]["severity"] == "block"
    # R1 is always blocking regardless of source type
    r1 = validate_period("bad", "2025.08", "real", now=NOW)
    assert r1["violations"][0]["severity"] == "block"


def test_month_helpers():
    assert mi(2025, 1) == 2025 * 12 + 1
    assert month_index("2025.12") - month_index("2025.01") == 11


def test_r8_hint_conflict_reported():
    window = legal_window(NOW)
    result = validate_period(
        "2025.01",
        "2025.05",
        "mock",
        now=NOW,
        hint_start=window["legal_start_earliest"],
        hint_end=window["legal_end_latest"],
    )
    r8 = [v for v in result["violations"] if v["rule"] == "R8"]
    assert r8 and r8[0]["params"]["suggested_start"] == "2024.12"
    assert r8[0]["params"]["suggested_end"] == "2025.09"


def test_legal_window_itself_validates():
    window = legal_window(NOW)
    assert window == {
        "legal_start_earliest": "2024.12",
        "legal_end_latest": "2025.09",
        "now_month": "2026.10",
    }
    result = validate_period(
        window["legal_start_earliest"], window["legal_end_latest"], "mock", now=NOW
    )
    assert result["passed"] is True


def test_complete_period_derives_missing_bound():
    # start given: end = min(start+9, latest legal end)
    done = complete_period("2025.01", None, NOW)
    assert done["period_start"] == "2025.01"
    assert done["period_end"] == "2025.09"
    assert done["violations"] == []
    # end given: start = max(end-9, earliest legal start)
    done = complete_period(None, "2025.06", NOW)
    assert done["period_start"] == "2024.12"
    assert done["period_end"] == "2025.06"
    # neither given: full legal window
    done = complete_period(None, None, NOW)
    assert done["period_start"] == "2024.12"
    assert done["period_end"] == "2025.09"


def test_complete_period_impossible_start_blocks():
    # 2026.01 start leaves no window that can end >= 13 months ago
    done = complete_period("2026.01", None, NOW)
    assert done["violations"][0]["rule"] == "R8"


@pytest.mark.parametrize(
    "text,passed",
    [
        ("系统上线后稳定运行了8个月，日均处理300万条请求", True),
        ("系统运行了12个月", False),
        ("团队共15人", True),  # people count, not a duration phrase
        ("响应时间200ms", True),
        ("系统持续运行1年半", False),  # 18 months
    ],
)
def test_runtime_consistency(text, passed):
    result = check_runtime_consistency(text, "2025.01", "2025.08")
    assert result["passed"] is passed
    if not passed:
        assert result["violations"][0]["rule"] == "R4"
        assert result["violations"][0]["severity"] == "warning"


@pytest.mark.parametrize(
    "tech,version,start,expected",
    [
        ("Python", "3.11", "2024.01", "pass"),  # GA 2022.10 before start
        ("python", "3.13", "2024.01", "fail"),  # GA 2024.10 after start
        ("Spring Boot", "3.2", "2023.11", "pass"),
        ("Spring Boot", "3.2", "2023.10", "fail"),
        ("MySQL", "8.0.32", "2023.01", "pass"),  # 8.0.x falls back to 8.0
        ("Redis", "7.0", "2022.05", "pass"),
        ("Redis", "7.0", "2022.04", "fail"),
        ("Rust", "1.80", "2024.01", "off_table"),  # tech not in table
        ("Kubernetes", "1.50", "2024.01", "off_table"),  # version not in table
        ("Qwen", "2.5", "2025.01", "pass"),
        ("Kafka", None, "2023.01", "unspecified"),  # no version stated
    ],
)
def test_ga_ordering_three_branches(tech, version, start, expected):
    result = check_ga_ordering(tech, version, start)
    assert result["status"] == expected
    if expected == "fail":
        assert "after project start" in result["message"]
    if expected == "off_table":
        assert "tech" in result
