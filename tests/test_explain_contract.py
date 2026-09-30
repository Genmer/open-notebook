"""Cross-tier contract tests for the task-failure explain feature.

The backend emits action/fact label_keys and an ExplainResponse shape that the
frontend renders blindly (t(label_key), typed response). These tests pin both
sides together: backend constants vs the TaskExplainCard action map, the
pydantic response model vs the TS ExplainResponse type, and the mirrored
label_key list used by the frontend locale test.
"""

import re
from pathlib import Path

from api.explain_service import ACTION_LABEL_KEYS, _facts
from api.routers.explain import ExplainResponse

REPO_ROOT = Path(__file__).resolve().parents[1]
CARD_PATH = REPO_ROOT / "frontend" / "src" / "components" / "tasks" / "TaskExplainCard.tsx"
EXPLAIN_TS_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "api" / "explain.ts"
LOCALE_TEST_PATH = (
    REPO_ROOT / "frontend" / "src" / "lib" / "locales" / "explain-labels.test.ts"
)

EXPECTED_ACTIONS = {
    "retry",
    "open_models_settings",
    "open_credentials",
    "copy_diagnostics",
    "report_issue",
}


def _fact_label_keys():
    return {fact["label_key"] for fact in _facts("n", "t", "s", "e")}


def test_backend_whitelists_exactly_the_five_frontend_actions():
    assert set(ACTION_LABEL_KEYS) == EXPECTED_ACTIONS
    assert all(key.startswith("tasks.explain.") for key in ACTION_LABEL_KEYS.values())


def test_frontend_action_map_and_switch_cover_every_backend_action():
    card = CARD_PATH.read_text(encoding="utf-8")
    for action, label_key in ACTION_LABEL_KEYS.items():
        # the ACTION_LABEL_KEYS entry and a matching switch case must both exist
        # (TS object keys may be unquoted, so match both spellings)
        entry = re.search(rf"['\"]?{re.escape(action)}['\"]?\s*:\s*'{label_key}'", card)
        assert entry, (
            f"TaskExplainCard is missing the ACTION_LABEL_KEYS entry for '{action}'"
        )
        assert f"case '{action}':" in card, (
            f"TaskExplainCard has no render case for backend action '{action}'"
        )


def test_frontend_fact_whitelist_covers_every_backend_fact_key():
    card = CARD_PATH.read_text(encoding="utf-8")
    for label_key in _fact_label_keys():
        assert f"'{label_key}'" in card, (
            f"TaskExplainCard FACT_LABEL_KEYS is missing '{label_key}'"
        )


def _ts_interface_fields(source: str, interface_name: str) -> set:
    block = source.split(f"export interface {interface_name}", 1)[1]
    block = block.split("\n}", 1)[0]
    # optional TS fields (name?:) count the same as required ones
    return set(re.findall(r"^\s+(\w+)\??:", block, re.MULTILINE))


def test_frontend_explain_response_type_matches_pydantic_model():
    source = EXPLAIN_TS_PATH.read_text(encoding="utf-8")

    ts_fields = _ts_interface_fields(source, "ExplainResponse")
    assert ts_fields == set(ExplainResponse.model_fields), (
        f"ExplainResponse drift — backend: {sorted(ExplainResponse.model_fields)}, "
        f"frontend explain.ts: {sorted(ts_fields)}"
    )

    # item shapes must also line up field-by-field
    assert _ts_interface_fields(source, "ExplainSuggestion") == {"action", "label_key"}
    assert _ts_interface_fields(source, "ExplainFact") == {"label_key", "value"}


def test_locale_test_mirrors_the_full_backend_label_key_set():
    """The frontend locale test's key list must track the backend constants."""
    test_source = LOCALE_TEST_PATH.read_text(encoding="utf-8")
    mirrored = set(re.findall(r"'(tasks\.explain\.\w+)'", test_source))

    expected = set(ACTION_LABEL_KEYS.values()) | _fact_label_keys()
    assert mirrored == expected, (
        f"frontend/src/lib/locales/explain-labels.test.ts key list drifted — "
        f"missing: {sorted(expected - mirrored)}, extra: {sorted(mirrored - expected)}"
    )
