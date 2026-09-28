"""
Unit tests for open_notebook.ai.model_pricing — the pure lookup/conversion
helpers. Network access (fetch_price_db) is not exercised here.
"""

import asyncio

import pytest

from open_notebook.ai import model_pricing
from open_notebook.ai.model_pricing import (
    _candidate_keys,
    _entry_costs,
    estimate_cost_cny,
    match_official_prices,
    match_official_prices_any_provider,
    match_price_entry,
    match_price_entry_any_provider,
    usd_to_cny,
)

PRICE_DB = {
    "gpt-4o": {
        "input_cost_per_token": 0.0000025,
        "output_cost_per_token": 0.00001,
    },
    "dashscope/qwen-plus": {
        "input_cost_per_token": 0.0000004,
        "output_cost_per_token": 0.0000012,
    },
    "dashscope/qwen-flash": {
        "litellm_provider": "dashscope",
        "tiered_pricing": [
            {"input_cost_per_token": 5e-08, "output_cost_per_token": 4e-07, "range": [0, 256000]},
            {"input_cost_per_token": 2.5e-07, "output_cost_per_token": 2e-06, "range": [256000, 1000000]},
        ],
    },
    "llama3:free": {"input_cost_per_token": 0.0, "output_cost_per_token": 0.0},
    "input-only-model": {"input_cost_per_token": 0.000001},
    "no-prices": {"max_tokens": 8192},
}


class TestCandidateKeys:
    def test_plain_name_tries_exact_then_lowercased(self):
        assert _candidate_keys("GPT-4o", None) == ["GPT-4o", "gpt-4o"]

    def test_provider_prefix_is_stripped(self):
        assert "qwen-plus" in _candidate_keys("dashscope/qwen-plus", None)

    def test_variant_suffix_is_stripped(self):
        assert "llama3" in _candidate_keys("llama3:free", None)

    def test_provider_scoped_keys_are_appended(self):
        keys = _candidate_keys("qwen-plus", "dashscope")
        assert keys[-1] == "dashscope/qwen-plus"

    def test_empty_name_yields_no_candidates(self):
        assert _candidate_keys("", None) == []
        assert _candidate_keys("  ", None) == []


class TestEntryCosts:
    def test_costs_are_scaled_to_per_million_usd(self):
        assert _entry_costs(PRICE_DB["gpt-4o"]) == (2.5, 10.0)

    def test_missing_side_defaults_to_zero(self):
        assert _entry_costs(PRICE_DB["input-only-model"]) == (1.0, 0.0)

    def test_tiered_pricing_uses_first_tier(self):
        assert _entry_costs(PRICE_DB["dashscope/qwen-flash"]) == pytest.approx((0.05, 0.4))

    def test_entry_without_prices_is_none(self):
        assert _entry_costs(PRICE_DB["no-prices"]) is None
        assert _entry_costs(None) is None
        assert _entry_costs("gpt-4o") is None


class TestMatchPriceEntry:
    def test_direct_match_returns_usd_per_million(self):
        matched = match_price_entry(PRICE_DB, "gpt-4o")
        assert matched == {
            "matched_key": "gpt-4o",
            "input_per_m_usd": 2.5,
            "output_per_m_usd": 10.0,
        }

    def test_provider_scoped_name_matches_after_prefix_strip(self):
        matched = match_price_entry(PRICE_DB, "dashscope/qwen-plus")
        assert matched is not None
        assert matched["matched_key"] == "dashscope/qwen-plus"

    def test_tiered_entry_matches_with_first_tier_prices(self):
        matched = match_price_entry(PRICE_DB, "qwen-flash", "dashscope")
        assert matched is not None
        assert matched["matched_key"] == "dashscope/qwen-flash"
        assert matched["input_per_m_usd"] == pytest.approx(0.05)
        assert matched["output_per_m_usd"] == pytest.approx(0.4)

    def test_unmatched_model_returns_none(self):
        assert match_price_entry(PRICE_DB, "unknown-model") is None


class TestUsdToCny:
    def test_default_rate(self, monkeypatch):
        monkeypatch.delenv("OPEN_NOTEBOOK_USD_CNY", raising=False)
        assert usd_to_cny() == 7.2

    def test_override_rate(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_USD_CNY", "7.0")
        assert usd_to_cny() == 7.0

    def test_invalid_or_nonpositive_falls_back(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_USD_CNY", "not-a-number")
        assert usd_to_cny() == 7.2
        monkeypatch.setenv("OPEN_NOTEBOOK_USD_CNY", "-1")
        assert usd_to_cny() == 7.2


class TestMatchOfficialPrices:
    def test_exact_match_returns_cny_per_million(self):
        matched = match_official_prices("mimo-v2.6-pro", "xiaomi_mimo")
        assert matched == {
            "matched_key": "mimo-v2.6-pro",
            "price_input_per_m": 3.0,
            "price_output_per_m": 6.0,
            "price_source": "official",
        }

    def test_longest_pattern_wins(self):
        matched = match_official_prices("mimo-v2.6-pro-ultraspeed", "xiaomi_mimo")
        assert matched is not None
        assert matched["matched_key"] == "mimo-v2.6-pro-ultraspeed"
        assert matched["price_input_per_m"] == 30.0

    def test_case_and_whitespace_insensitive(self):
        matched = match_official_prices("  MIMO-V2.6-Flash ", "Xiaomi_Mimo")
        assert matched is not None
        assert matched["matched_key"] == "mimo-v2.6-flash"

    def test_provider_scoped(self):
        # Same model name under a provider without an official table: no match.
        assert match_official_prices("mimo-v2.6-pro", "openai") is None
        assert match_official_prices("mimo-v2.6-pro", None) is None

    def test_unknown_model_returns_none(self):
        assert match_official_prices("gpt-4o", "xiaomi_mimo") is None

    def test_token_plan_shares_the_table(self):
        matched = match_official_prices("mimo-v2.6-flash", "xiaomi_mimo_token_plan")
        assert matched is not None
        assert matched["price_output_per_m"] == 2.0


class TestOfficialFallbackAnyProvider:
    def test_matches_by_model_id_alone(self):
        matched = match_official_prices_any_provider("mimo-v2.6-pro")
        assert matched == {
            "matched_key": "xiaomi_mimo:mimo-v2.6-pro",
            "price_input_per_m": 3.0,
            "price_output_per_m": 6.0,
            "price_source": "official",
        }

    def test_longest_pattern_wins_across_tables(self):
        matched = match_official_prices_any_provider("mimo-v2.6-pro-ultraspeed")
        assert matched is not None
        assert matched["matched_key"] == "xiaomi_mimo:mimo-v2.6-pro-ultraspeed"
        assert matched["price_input_per_m"] == 30.0

    def test_unknown_model_returns_none(self):
        assert match_official_prices_any_provider("gpt-4o") is None
        assert match_official_prices_any_provider("") is None


class TestLiteLLMFallbackAnyProvider:
    def test_finds_provider_prefixed_entry(self):
        matched = match_price_entry_any_provider(PRICE_DB, "qwen-plus")
        assert matched is not None
        assert matched["matched_key"] == "dashscope/qwen-plus"
        # Per-token floats scale with rounding noise; compare approximately.
        assert matched["input_per_m_usd"] == pytest.approx(0.4)
        assert matched["output_per_m_usd"] == pytest.approx(1.2)

    def test_ties_resolve_alphabetically(self):
        db = {
            "zeta/gpt-4o": {"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06},
            "alpha/gpt-4o": {"input_cost_per_token": 3e-06, "output_cost_per_token": 4e-06},
        }
        matched = match_price_entry_any_provider(db, "gpt-4o")
        assert matched is not None
        assert matched["matched_key"] == "alpha/gpt-4o"

    def test_no_match_returns_none(self):
        assert match_price_entry_any_provider(PRICE_DB, "nonexistent-model") is None


class TestFetchModelPricesFallbackChain:
    @pytest.fixture
    def local_db(self, monkeypatch):
        async def fake_db(force: bool = False):
            return PRICE_DB

        monkeypatch.setattr(model_pricing, "fetch_price_db", fake_db)

    def test_official_fallback_for_generic_provider(self, local_db):
        # mimo filed under "openai": no LiteLLM entry, official table by id.
        result = asyncio.run(model_pricing.fetch_model_prices("mimo-v2.6-pro", "openai"))
        assert result is not None
        assert result["price_source"] == "official"
        assert result["matched_key"] == "xiaomi_mimo:mimo-v2.6-pro"

    def test_litellm_fallback_for_generic_provider(self, local_db):
        # qwen-plus filed under a generic provider: LiteLLM has it only under
        # the dashscope/ prefix.
        result = asyncio.run(
            model_pricing.fetch_model_prices("qwen-plus", "openai_compatible")
        )
        assert result is not None
        assert result["matched_key"] == "dashscope/qwen-plus"
        assert result["price_source"] == "litellm"

    def test_own_provider_beats_fallback(self, local_db):
        result = asyncio.run(model_pricing.fetch_model_prices("qwen-plus", "dashscope"))
        assert result is not None
        assert result["matched_key"] == "dashscope/qwen-plus"


class TestEstimateCostCny:
    def test_tokens_scaled_by_per_million_price(self):
        cost = estimate_cost_cny(1_000_000, 500_000, 2.0, 8.0)
        assert cost == 2.0 + 4.0

    def test_none_prices_mean_no_estimate(self):
        assert estimate_cost_cny(1000, 1000, None, None) is None

    def test_null_tokens_coalesce_to_zero(self):
        assert estimate_cost_cny(None, None, 2.0, 8.0) == 0.0

    def test_partial_price_treats_missing_side_as_zero(self):
        # Only an input price stored: output tokens are free, not unpriced.
        assert estimate_cost_cny(1_000_000, 999_999, 2.0, None) == 2.0
