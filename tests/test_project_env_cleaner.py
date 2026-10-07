"""Tests for open_notebook/domain/project_env_cleaner.py.

Pure-function tests (no DB, no LLM): sentence-level removal across the 人员/
规模/资金 three categories, plus the scale whole-field special case, over the
three containers (main fields / draft_content / verified_snapshot). Residue
sentences come from the recon-extracted legacy environment texts (README
item 4) and the deep-read exam material; keep-cases pin the anti-false-
positive boundaries documented in the cleaner docstring.
"""

import pytest

from open_notebook.domain.project_env import TEXT_FIELDS, ProjectEnv
from open_notebook.domain.project_env_cleaner import (
    FORBIDDEN_PHRASES,
    apply_env_cleaning,
    clean_text,
    plan_env_cleaning,
    removed_sentences,
)

# Recon residue: the legacy ENV2-scale shape (forbidden sentences first).
RESIDUE_SCALE = (
    "项目合同金额约360万元。我带领17人团队完成建设，涵盖算法、后端、前端、"
    "测试等专业，大模型推理运行于私有化部署的GPU服务器上。"
)


def _env(**overrides) -> ProjectEnv:
    data = dict(
        id="project_env:cleaner1",
        name="内部应用助手",
        background="系统于2025年9月通过终验。",
        period_start="2024.12",
        period_end="2025.08",
        source_type="mock",
        status="pending",
        generic_paragraph="用户自己写的段落，含合同金额也不清洗。",
    )
    data.update(overrides)
    return ProjectEnv(**data)


class TestCleanText:
    def test_funds_and_personnel_sentences_both_removed(self):
        # 金额锚（360万元）与「17人+团队」两句全删
        assert clean_text("项目合同金额约360万元。我带领17人团队完成建设。") == ""

    def test_real_residue_scale_text_fully_dropped(self):
        assert clean_text(RESIDUE_SCALE) == ""

    def test_team_scale_variant(self):
        assert clean_text("团队规模18人。日均订单2.8万条。") == "日均订单2.8万条。"

    def test_team_count_variant(self):
        assert clean_text("日均订单2.8万条。团队人数17人。") == "日均订单2.8万条。"

    @pytest.mark.parametrize(
        "text",
        [
            RESIDUE_SCALE,
            "项目合同金额约360万元。我带领17人团队完成建设。",
            "团队规模18人。日均订单2.8万条。",
            "前期调研发现，合同金额需复核，随后立项。项目正常推进。",
            "我带领项目团队完成核心攻关。支持2000人同时在线。",
            "项目合同金额约360万元",
            # 规则命中后剩余文本再跑一遍必须零变更（新规则幂等）
            clean_text(RESIDUE_SCALE),
        ],
    )
    def test_clean_text_is_idempotent(self, text):
        once = clean_text(text)
        assert clean_text(once) == once

    def test_no_forbidden_pattern_returned_unchanged(self):
        text = "我带领项目团队完成核心攻关。日均处理约2.8万条配送订单，服务6000家门店。"
        assert clean_text(text) == text

    def test_all_sentences_forbidden_returns_empty(self):
        assert clean_text("项目合同金额约360万元。团队规模17人。团队人数含外包。") == ""
        # newline-separated forbidden sentences leave no whitespace residue
        assert clean_text("团队规模18人。\n团队人数17人。\n") == ""

    def test_none_returns_empty(self):
        assert clean_text(None) == ""
        assert clean_text("") == ""

    def test_semicolon_and_newline_boundaries(self):
        assert (
            clean_text("项目合同金额约360万元；我带领项目团队攻关。")
            == "我带领项目团队攻关。"
        )
        assert clean_text("团队规模18人。\n日均订单2.8万条。") == "日均订单2.8万条。"

    def test_halfwidth_delimiters_split_too(self):
        # the gap a dropped sentence leaves behind is consumed (lstrip)
        assert clean_text("合同金额360万元! kept sentence.") == "kept sentence."
        assert clean_text("团队规模12人; fine? ok.") == "fine? ok."

    def test_phrase_inside_longer_sentence_drops_whole_sentence(self):
        # Comma-level clauses are NOT split: the whole sentence goes, so the
        # remaining text never carries dangling punctuation.
        assert clean_text("前期调研发现，合同金额需复核，随后立项。项目正常推进。") == (
            "项目正常推进。"
        )

    def test_unpunctuated_forbidden_text_fully_dropped(self):
        assert clean_text("本项目合同金额约360万元") == ""

    def test_kept_sentences_keep_structure_verbatim(self):
        text = "第一句保留。\n第二句也保留，含逗号与（括号）。"
        assert clean_text(text) == text

    def test_dropped_middle_sentence_leaves_no_double_break(self):
        assert clean_text("保留甲。\n团队规模17人。\n保留乙。") == "保留甲。\n保留乙。"

    def test_removed_sentences_lists_exactly_the_dropped_pieces(self):
        assert removed_sentences(RESIDUE_SCALE) == [
            "项目合同金额约360万元。",
            "我带领17人团队完成建设，涵盖算法、后端、前端、测试等专业，"
            "大模型推理运行于私有化部署的GPU服务器上。",
        ]
        assert removed_sentences("我带领项目团队完成建设。") == []
        assert removed_sentences(None) == []
        assert removed_sentences("") == []


class TestThreeCategoryBoundaries:
    """防误伤边界（设计 10 条，逐条固化为用例；keep-用例引用实况/范文原句）。"""

    @pytest.mark.parametrize(
        "text",
        [
            "我带领项目团队完成核心攻关。",  # 边界1：无数字团队叙事（my_role 技法必需）
            "组织各事业部需求调研，梳理痛点。",  # 边界1
        ],
    )
    def test_keeps_numeric_free_team_narrative(self, text):
        assert clean_text(text) == text

    @pytest.mark.parametrize(
        "text",
        [
            "压测中系统支持2000人同时在线。",  # 边界2：数字+人但无人员语境词
            "500并发下P95响应稳定在2.6秒。",  # 边界2：并发容量口径
        ],
    )
    def test_keeps_capacity_numbers_without_personnel_context(self, text):
        assert clean_text(text) == text

    def test_keeps_person_month_and_per_capita(self):
        # 边界3：负向环视与后缀不匹配
        assert clean_text("本项目累计投入40人月。") == "本项目累计投入40人月。"
        assert clean_text("人均处理单量提升30%。") == "人均处理单量提升30%。"

    def test_keeps_role_sentence_untouched(self):
        # 边界4：实况 my_role 全句无损
        text = (
            "我在本项目中担任项目负责人兼系统架构师，全面负责立项调研与总体架构设计。"
        )
        assert clean_text(text) == text

    @pytest.mark.parametrize(
        "text",
        [
            "公司自筹资金完成了平台建设。",  # 边界5：资金语境词无数字
            "培训成本居高不下，倒逼智能化改造。",  # 边界5
            "各项指标均达到合同要求。",  # 边界5：裸「合同」不在语境表
            "避免自建算力的一次性投入。",  # 边界5：「投入」非「投资」
        ],
    )
    def test_keeps_amount_free_funds_wording(self, text):
        assert clean_text(text) == text

    @pytest.mark.parametrize(
        "text",
        [
            "企业投资500万建设算力中心。",  # 边界6：资金语境×数字（无元锚也删）
            "全年算力成本同比下降29%。",  # 边界6：成本类效果数据不进环境
            "成本由360万元压缩至120万元。",  # 边界6：金额锚
        ],
    )
    def test_drops_funds_with_numerals(self, text):
        assert clean_text(text) == ""

    @pytest.mark.parametrize(
        "text",
        [
            "我们12人团队分四个小组同步开发。",  # 宝典反例
            "统筹三十余人的产研与业务团队。",  # 押题03反例
            "统筹十五人核心研发团队。",  # 押题02反例
            "六十人架构团队支撑本次改造。",  # 押题02反例
            "项目团队共18人，涵盖多个岗位。",  # 实况 draft_content.scale
            "一家拥有员工8000余人的物流企业。",  # 实况 background
        ],
    )
    def test_drops_known_personnel_offenders(self, text):
        assert clean_text(text) == ""

    def test_drops_user_scale_keeps_userfree_staff_wording(self):
        # 边界8：规模语境×数量 / N+用户后缀；无数字员工表述保留
        assert clean_text("月活跃用户达6500人。") == ""
        assert clean_text("注册用户12万人。") == ""
        assert clean_text("全公司员工均为最终用户。") == "全公司员工均为最终用户。"

    def test_exact_scale_topic_phrases_drop_sentence(self):
        assert clean_text("项目规模空前庞大。") == ""
        assert clean_text("用户规模持续扩大。") == ""


class TestScaleFieldWholeClear:
    """scale 字段整段清空特例：句级过滤会残留规模残渣，非空即整段替换。"""

    def test_nonempty_scale_cleared_even_without_banned_words(self):
        env = _env(scale="日均处理约2.8万条配送订单，500并发下运行平稳。")
        plan = plan_env_cleaning(env)
        assert plan["main"]["scale"] == {
            "before": "日均处理约2.8万条配送订单，500并发下运行平稳。",
            "after": "",
        }
        assert apply_env_cleaning(env) == 1
        assert env.scale == ""

    def test_scale_cleared_in_every_container(self):
        env = _env(
            draft_content={"scale": "平台最终接入内部应用23个。"},
            verified_snapshot={"scale": "项目团队共18人。"},
        )
        changed = apply_env_cleaning(env)
        assert changed == 2
        assert env.draft_content is not None
        assert env.verified_snapshot is not None
        assert env.draft_content["scale"] == ""
        assert env.verified_snapshot["scale"] == ""

    def test_empty_and_none_scale_untouched(self):
        env = _env(scale="", draft_content={"scale": None}, verified_snapshot=None)
        assert plan_env_cleaning(env) == {}
        assert apply_env_cleaning(env) == 0
        assert env.scale == ""


class TestPlanAndApply:
    def test_three_containers_cleaned_in_place(self):
        env = _env(
            scale=RESIDUE_SCALE,
            draft_content={
                "name": "内部应用助手",
                "period_start": "2024.12",
                "period_end": "2025.08",
                "source_type": "mock",
                "scale": RESIDUE_SCALE,
                "tech_background": "基座模型选用Qwen2.5-14B-Instruct。团队规模17人。",
            },
            verified_snapshot={
                "name": "内部应用助手",
                "frozen_at": "2026-10-01T00:00:00",
                "scale": "合同金额约360万元。我带领17人团队完成建设。",
            },
        )
        changed = apply_env_cleaning(env)

        # main.scale + draft.scale + draft.tech_background + snapshot.scale
        assert changed == 4
        assert env.draft_content is not None
        assert env.verified_snapshot is not None
        for source in (
            {f: getattr(env, f) for f in TEXT_FIELDS},
            env.draft_content or {},
            env.verified_snapshot or {},
        ):
            for field in TEXT_FIELDS:
                value = source.get(field)
                if isinstance(value, str):
                    assert not any(p in value for p in FORBIDDEN_PHRASES), field

        # scale 整段清空（而非句级残留）
        assert env.scale == ""
        assert env.draft_content["scale"] == ""
        assert env.verified_snapshot["scale"] == ""
        assert (
            env.draft_content["tech_background"] == "基座模型选用Qwen2.5-14B-Instruct。"
        )
        # non-TEXT_FIELDS keys and user content survive untouched
        assert env.verified_snapshot["frozen_at"] == "2026-10-01T00:00:00"
        assert env.verified_snapshot["name"] == "内部应用助手"
        assert env.status == "pending"
        assert env.name == "内部应用助手"
        assert env.generic_paragraph == "用户自己写的段落，含合同金额也不清洗。"
        assert env.background == "系统于2025年9月通过终验。"

        # plan -> apply -> plan is empty (fully converged)
        assert plan_env_cleaning(env) == {}
        assert apply_env_cleaning(env) == 0

    def test_plan_shows_whole_scale_replacement_without_mutating(self):
        env = _env(scale=RESIDUE_SCALE)
        plan = plan_env_cleaning(env)
        assert set(plan) == {"main"}
        assert set(plan["main"]) == {"scale"}
        change = plan["main"]["scale"]
        assert change["before"] == RESIDUE_SCALE
        assert change["after"] == ""
        assert "合同金额" in change["before"]
        assert env.scale == RESIDUE_SCALE  # plan never mutates

    def test_clean_env_yields_empty_plan(self):
        env = _env(my_role="我带领项目团队完成核心攻关。", scale="")
        assert plan_env_cleaning(env) == {}
        assert apply_env_cleaning(env) == 0

    def test_all_banned_sentences_leave_empty_string(self):
        env = _env(tech_background="项目合同金额约360万元。团队规模17人。")
        assert apply_env_cleaning(env) == 1
        assert env.tech_background == ""

    def test_non_string_and_missing_container_values_ignored(self):
        env = _env(
            draft_content={"scale": None, "name": "内部应用助手"},
            verified_snapshot=None,
        )
        assert plan_env_cleaning(env) == {}
        assert apply_env_cleaning(env) == 0
        assert (env.draft_content or {})["scale"] is None


class TestMaintainerScriptHelpers:
    """scripts/clean_project_env_forbidden_words.py: the dry-run diff printer
    and the pre-apply JSON backup payload. The script itself is never run
    with --apply inside the delivery workflow (maintainer-only step)."""

    def test_diff_printer_lists_removed_sentences(self, capsys):
        from scripts.clean_project_env_forbidden_words import _print_diff

        env = _env(scale=RESIDUE_SCALE)
        _print_diff(env, plan_env_cleaning(env))
        out = capsys.readouterr().out
        assert "[project_env:cleaner1] 内部应用助手 (status=pending)" in out
        assert "main.scale:" in out
        assert "- 删除: 项目合同金额约360万元。" in out
        assert "- 删除: 我带领17人团队完成建设" in out
        assert "= 清洗后: (空)" in out

    def test_diff_printer_whole_clear_without_banned_words(self, capsys):
        from scripts.clean_project_env_forbidden_words import _print_diff

        env = _env(scale="日均订单2.8万条。")
        _print_diff(env, plan_env_cleaning(env))
        out = capsys.readouterr().out
        assert "main.scale:" in out
        assert "删除" not in out  # 无禁词命中：仅展示整段清空
        assert "= 清洗后: (空)" in out

    def test_backup_payload_captures_original_values(self):
        from scripts.clean_project_env_forbidden_words import _backup_payload

        env = _env(scale=RESIDUE_SCALE)
        payload = _backup_payload([env])
        assert payload["forbidden_phrases"] == list(FORBIDDEN_PHRASES)
        assert payload["records"][0]["id"] == "project_env:cleaner1"
        assert payload["records"][0]["scale"] == RESIDUE_SCALE
