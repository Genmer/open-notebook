"""
Pytest configuration file.

This file ensures that the project root is in the Python path,
allowing tests to import from the api and open_notebook modules.
"""

import os
import sys
from pathlib import Path

import pytest

# Ensure password auth is disabled for tests BEFORE any imports
# The PasswordAuthMiddleware skips auth when this env var is not set
# Set to empty string instead of deleting to prevent it from being reloaded
os.environ["OPEN_NOTEBOOK_PASSWORD"] = ""

# Load environment variables from .env file
# This must be done BEFORE any imports that depend on environment variables
from dotenv import load_dotenv

# Load .env file from project root
dotenv_path = Path(__file__).parent.parent / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)
    print(f"Loaded environment variables from {dotenv_path}")
else:
    print(f"Warning: .env file not found at {dotenv_path}")

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


@pytest.fixture(autouse=True)
def _no_project_env_llm_pacing(monkeypatch):
    """The verification pipeline meters real LLM call starts; tests patch the
    provider and must not inherit the pacing sleeps."""
    from open_notebook.ai import project_env_pipeline

    monkeypatch.setattr(project_env_pipeline, "LLM_CALL_MIN_INTERVAL_SECONDS", 0.0)
    monkeypatch.setattr(project_env_pipeline, "_LLM_PACE_LAST", 0.0)
