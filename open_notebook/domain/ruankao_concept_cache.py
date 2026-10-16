"""Ruankao question-2 concept knowledge cache (软考概念知识缓存).

Public exam-domain concept definitions gathered from web verification, keyed
by the canonical concept name — a hit answers the next question workbench run
without another search. Per ADR-017 the cache holds generic public knowledge
only and never relates to or copies model essay content.
"""

from typing import ClassVar, List, Optional

from open_notebook.domain.base import ObjectModel


class RuankaoConceptCache(ObjectModel):
    table_name: ClassVar[str] = "ruankao_concept_cache"
    nullable_fields: ClassVar[set[str]] = {"domain", "key_points", "exam_focus"}

    name: str  # canonical concept name, unique
    category: str = ""
    domain: Optional[str] = None
    definition: str = ""
    key_points: Optional[List[str]] = None
    exam_focus: Optional[str] = None
    source: str = ""

    @classmethod
    async def lookup_many(cls, names: List[str]) -> dict:
        """{name -> row dict} for the given concept names. DB failures
        degrade to {}: cache misses only cost an extra web search."""
        wanted = sorted({str(n or "").strip() for n in names if str(n or "").strip()})
        if not wanted:
            return {}
        from open_notebook.database.repository import repo_query

        try:
            rows = await repo_query(
                "SELECT * FROM ruankao_concept_cache WHERE name IN $names",
                {"names": wanted},
            )
        except Exception:
            return {}
        return {str(row.get("name") or ""): row for row in rows or []}
