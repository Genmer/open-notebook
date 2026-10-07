"""Tests for open_notebook/domain/project_env_cleaner.py.

Pure-function tests (no DB, no LLM): sentence-level removal of the banned
exam-essay phrases (合同金额/团队规模/团队人数) across the three containers
(main fields / draft_content / verified_snapshot). The residue sentences come
from the recon-extracted legacy environment texts (README item 4).
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

# Recon residue: the legacy ENV2-scale shape (forbidden sentence first).
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
    def test_forbidden_sentence_removed_rest_kept_verbatim(self):
        assert (
            clean_text("项目合同金额约360万元。我带领17人团队完成建设。")
            == "我带领17人团队完成建设。"
        )

    def test_real_residue_scale_text(self):
        assert clean_text(RESIDUE_SCALE) == (
            "我带领17人团队完成建设，涵盖算法、后端、前端、测试等专业，"
            "大模型推理运行于私有化部署的GPU服务器上。"
        )

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
            "我带领17人团队完成建设。",
            "项目合同金额约360万元",
        ],
    )
    def test_clean_text_is_idempotent(self, text):
        once = clean_text(text)
        assert clean_text(once) == once

    def test_no_forbidden_phrase_returned_unchanged(self):
        text = "我带领17人团队完成建设。日均处理约2.8万条配送订单，服务6000家门店。"
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
            clean_text("项目合同金额约360万元；我带领17人团队。") == "我带领17人团队。"
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
        assert removed_sentences(RESIDUE_SCALE) == ["项目合同金额约360万元。"]
        assert removed_sentences("我带领17人团队完成建设。") == []
        assert removed_sentences(None) == []
        assert removed_sentences("") == []


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
        for source in (
            {f: getattr(env, f) for f in TEXT_FIELDS},
            env.draft_content or {},
            env.verified_snapshot or {},
        ):
            for field in TEXT_FIELDS:
                value = source.get(field)
                if isinstance(value, str):
                    assert not any(p in value for p in FORBIDDEN_PHRASES), field

        assert env.scale == (
            "我带领17人团队完成建设，涵盖算法、后端、前端、测试等专业，"
            "大模型推理运行于私有化部署的GPU服务器上。"
        )
        assert (env.draft_content or {})["tech_background"] == (
            "基座模型选用Qwen2.5-14B-Instruct。"
        )
        # non-TEXT_FIELDS keys and user content survive untouched
        assert (env.verified_snapshot or {})["frozen_at"] == "2026-10-01T00:00:00"
        assert (env.verified_snapshot or {})["name"] == "内部应用助手"
        assert env.status == "pending"
        assert env.name == "内部应用助手"
        assert env.generic_paragraph == "用户自己写的段落，含合同金额也不清洗。"
        assert env.background == "系统于2025年9月通过终验。"

        # plan -> apply -> plan is empty (fully converged)
        assert plan_env_cleaning(env) == {}
        assert apply_env_cleaning(env) == 0

    def test_plan_shows_before_and_after_without_mutating(self):
        env = _env(scale=RESIDUE_SCALE)
        plan = plan_env_cleaning(env)
        assert set(plan) == {"main"}
        assert set(plan["main"]) == {"scale"}
        change = plan["main"]["scale"]
        assert change["before"] == RESIDUE_SCALE
        assert change["after"] == (
            "我带领17人团队完成建设，涵盖算法、后端、前端、测试等专业，"
            "大模型推理运行于私有化部署的GPU服务器上。"
        )
        assert "合同金额" in change["before"]
        assert env.scale == RESIDUE_SCALE  # plan never mutates

    def test_clean_env_yields_empty_plan(self):
        env = _env(
            scale="我组建并带领项目团队共15人，日均处理约2.8万条配送订单。",
        )
        assert plan_env_cleaning(env) == {}
        assert apply_env_cleaning(env) == 0

    def test_all_banned_sentences_leave_empty_string(self):
        env = _env(scale="项目合同金额约360万元。团队规模17人。")
        assert apply_env_cleaning(env) == 1
        assert env.scale == ""

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
        assert "= 清洗后: 我带领17人团队完成建设" in out

    def test_backup_payload_captures_original_values(self):
        from scripts.clean_project_env_forbidden_words import _backup_payload

        env = _env(scale=RESIDUE_SCALE)
        payload = _backup_payload([env])
        assert payload["forbidden_phrases"] == list(FORBIDDEN_PHRASES)
        assert payload["records"][0]["id"] == "project_env:cleaner1"
        assert payload["records"][0]["scale"] == RESIDUE_SCALE
