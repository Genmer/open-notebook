"""TS↔Python 行业池逐字对账（防双份语料漂移的核心守护）。

前端 frontend/src/lib/ruankao/industry-pool.ts 与后端
open_notebook/ai/industry_pool.py 各持一份 77 条「行业名→业务特征提示」
语料：name 是落库值 env.industry 与后端查表键，逐字不可改；改池必须
两处同改。本文件断言两侧键集合与每个 hint 字符串完全相等。
（设计稿 docs/7-DEVELOPMENT/plans/industry-pool-upgrade-design.md ⑧-8）

行业画像（INDUSTRY_PROFILES）双镜像同账：TS camelCase 键 ↔ Python
snake_case 键按固定映射逐字比对（设计稿裁决 #13）。
"""

import re
from pathlib import Path

import pytest

from open_notebook.ai.industry_pool import INDUSTRY_HINTS, INDUSTRY_PROFILES

REPO_ROOT = Path(__file__).resolve().parents[1]
TS_POOL_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "ruankao" / "industry-pool.ts"
TS_ENTRY = re.compile(r"\{ name: '(.+?)', hint: '(.+?)' \}")
# 行业画像条目行（生成器 scripts/build_industry_profiles.py 固定一行一条）：
#   '行业名': { projectForms: [...], techStack: [...], businessFlows: [...] },
TS_PROFILE_ENTRY = re.compile(
    r"^  '(.+?)': \{ projectForms: \[(.*?)\], techStack: \[(.*?)\],"
    r" businessFlows: \[(.*?)\] \},?$",
    re.MULTILINE,
)
TS_TS_ARRAY_ITEM = re.compile(r"'([^']*)'")


def _ts_entries() -> list[tuple[str, str]]:
    text = TS_POOL_PATH.read_text(encoding="utf-8")
    return TS_ENTRY.findall(text)


def test_frontend_pool_has_exactly_77_unique_entries():
    entries = _ts_entries()
    assert len(entries) == 77
    names = [name for name, _ in entries]
    assert len(set(names)) == len(names)


def test_backend_pool_mirrors_frontend_exactly():
    entries = _ts_entries()
    ts_hints = dict(entries)
    assert set(ts_hints) == set(INDUSTRY_HINTS)
    for name, hint in entries:
        assert INDUSTRY_HINTS[name] == hint, f"hint 漂移：{name}"


@pytest.mark.parametrize("name,hint", sorted(INDUSTRY_HINTS.items()))
def test_backend_hints_non_empty_and_bounded(name, hint):
    assert hint.strip()
    assert len(hint) <= 40, f"{name} 的 hint 超 40 字"


# --- 行业画像（INDUSTRY_PROFILES）双镜像对账 ---

# TS camelCase ↔ Python snake_case 键名映射（设计稿裁决 #13）
PROFILE_KEY_MAP = {
    "projectForms": "project_forms",
    "techStack": "tech_stack",
    "businessFlows": "business_flows",
}


def _ts_profiles() -> dict[str, dict[str, list[str]]]:
    text = TS_POOL_PATH.read_text(encoding="utf-8")
    start = text.index("export const INDUSTRY_PROFILES")
    profiles: dict[str, dict[str, list[str]]] = {}
    for name, forms, tech, flows in TS_PROFILE_ENTRY.findall(text[start:]):
        profiles[name] = {
            "project_forms": TS_TS_ARRAY_ITEM.findall(forms),
            "tech_stack": TS_TS_ARRAY_ITEM.findall(tech),
            "business_flows": TS_TS_ARRAY_ITEM.findall(flows),
        }
    return profiles


def test_profile_keys_are_subset_of_pool_names():
    names = {name for name, _ in _ts_entries()}
    extra = set(_ts_profiles()) - names
    assert not extra, f"画像键必须在 77 池 name 之内，池外：{extra}"
    extra_py = set(INDUSTRY_PROFILES) - names
    assert not extra_py, f"后端画像键必须在 77 池 name 之内，池外：{extra_py}"


def test_backend_profiles_mirror_frontend_exactly():
    ts_profiles = _ts_profiles()
    assert set(ts_profiles) == set(INDUSTRY_PROFILES), "画像键集合漂移"
    for name, ts_profile in ts_profiles.items():
        assert INDUSTRY_PROFILES[name] == ts_profile, f"画像漂移：{name}"


def test_profile_entries_non_empty_and_bounded():
    for name, profile in INDUSTRY_PROFILES.items():
        for field, low, high in (
            ("project_forms", 1, 4),
            ("tech_stack", 3, 6),
            ("business_flows", 3, 5),
        ):
            items = profile[field]
            assert low <= len(items) <= high, f"{name}.{field} 条数 {len(items)} 出界"
            for item in items:
                assert item.strip(), f"{name}.{field} 有空白条目"
                assert len(item) <= 25, f"{name}.{field} 条目超 25 字：{item}"


def test_profile_lookup_function_degrades_like_hint():
    from open_notebook.ai.industry_pool import industry_profile_for

    pool_industry = next(iter(INDUSTRY_PROFILES))
    assert industry_profile_for(pool_industry) == INDUSTRY_PROFILES[pool_industry]
    assert (
        industry_profile_for(f"  {pool_industry}  ") == INDUSTRY_PROFILES[pool_industry]
    )
    # 池内无画像 / 池外 / 空白：None（模板条件块不渲染，与未注入逐字节一致）
    hint_only = "智慧城管"
    assert hint_only in INDUSTRY_HINTS
    assert industry_profile_for(hint_only) is None
    assert industry_profile_for("医疗行业") is None
    assert industry_profile_for(None) is None
    assert industry_profile_for("   ") is None
