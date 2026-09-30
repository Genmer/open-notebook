"""Unit tests for credential redaction in open_notebook.utils.redact."""

from open_notebook.utils.redact import redact_text


def test_redacts_api_keys():
    assert redact_text("key sk-AbCdEf12345678 in logs") == "key [REDACTED] in logs"
    # shorter than 8 chars after sk- is not treated as a key
    assert redact_text("sk-short") == "sk-short"


def test_redacts_bearer_tokens():
    assert (
        redact_text("Authorization: Bearer eyJhbGciOi.abc.def")
        == "Authorization: [REDACTED]"
    )
    assert redact_text("bearer tok123") == "[REDACTED]"


def test_redacts_key_value_pairs():
    assert redact_text("api_key: secret123") == "[REDACTED]"
    assert redact_text("api-key=secret123") == "[REDACTED]"
    assert redact_text("apiKey: secret123") == "[REDACTED]"


def test_redacts_url_embedded_credentials():
    out = redact_text("connect to postgresql://admin:hunter2@db.local:8000/ns")
    assert "admin" not in out
    assert "hunter2" not in out
    assert "[REDACTED]" in out


def test_keeps_normal_urls():
    for url in (
        "https://example.com:8080/path?a=b",
        "postgres://localhost:5432/mydb",
        "https://example.com/@handle",
        "http://127.0.0.1:5055/api",
    ):
        assert redact_text(f"see {url} docs") == f"see {url} docs"


def test_empty_and_clean_text_pass_through():
    assert redact_text("") == ""
    assert redact_text("nothing to see here") == "nothing to see here"
