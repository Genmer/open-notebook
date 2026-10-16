"""Dynamic GA anchor cache (发布日期锚点缓存).

Static fallback table in project_env_rules only knows ~25 mainstream techs;
this table stores GA months resolved at runtime (web lookup or manual entry)
so the next verification of the same tech+version is a local read. Rows hold
public release-calendar facts only — per ADR-017 nothing here relates to or
copies model essay content.
"""

from typing import Any, ClassVar, Dict, List, Optional

from open_notebook.domain.base import ObjectModel


class GaAnchorCache(ObjectModel):
    table_name: ClassVar[str] = "ga_anchor_cache"
    nullable_fields: ClassVar[set[str]] = {"detail"}

    tech: str
    version: str
    ga: str  # "YYYY.MM"
    # where the anchor came from ("web:<url>" | "manual")
    source: str = ""
    # "web" rows may be refreshed by later lookups, "manual" ones win
    confidence: str = "web"
    detail: Optional[str] = None

    @classmethod
    async def lookup(cls, tech: str, version: str) -> Optional["GaAnchorCache"]:
        """Exact (tech, version) hit, or None. DB failures degrade to None:
        a cache outage must fall through to the web lookup, not fail the run."""
        key = (tech or "").strip().lower()
        version = (version or "").strip()
        if not key or not version:
            return None
        from open_notebook.database.repository import repo_query

        try:
            rows = await repo_query(
                "SELECT * FROM ga_anchor_cache "
                "WHERE tech = $tech AND version = $version LIMIT 1",
                {"tech": key, "version": version},
            )
        except Exception:
            return None
        if not rows:
            return None
        try:
            return cls(**rows[0])
        except Exception:
            return None

    @classmethod
    async def cleanup_dirty_records(cls, apply: bool = False) -> Dict[str, Any]:
        """Scan ga_anchor_cache for dirty records (invalid tech name or malformed GA month).
        Deletes them when apply is True; dry-run by default."""
        from open_notebook.domain.project_env_rules import is_month, is_valid_tech_name

        error_msg = None
        try:
            records = await cls.get_all()
        except Exception as e:
            from loguru import logger

            logger.error(f"ga_anchor_cache cleanup query failed: {e}")
            records = []
            error_msg = str(e)

        dirty_records: List[Dict[str, Any]] = []
        deleted_count = 0
        for r in records:
            reason = None
            if not is_valid_tech_name(r.tech):
                reason = f"invalid tech name: {r.tech}"
            elif not is_month(r.ga):
                reason = f"invalid ga month format: {r.ga}"
            if reason:
                dirty_records.append(
                    {
                        "id": r.id,
                        "tech": r.tech,
                        "version": r.version,
                        "ga": r.ga,
                        "reason": reason,
                    }
                )
                if apply and r.id:
                    try:
                        await r.delete()
                        deleted_count += 1
                    except Exception:
                        pass

        res: Dict[str, Any] = {
            "scanned": len(records),
            "dirty_count": len(dirty_records),
            "deleted_count": deleted_count,
            "dirty_records": dirty_records,
            "applied": apply,
        }
        if error_msg:
            res["error"] = error_msg
        return res
