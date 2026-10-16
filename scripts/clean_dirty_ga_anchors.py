"""Clean dirty records from ga_anchor_cache (T1).

Identifies records that have invalid tech names (e.g. business variables like
siteId, districtCode) or malformed GA months.

Usage:
    uv run python scripts/clean_dirty_ga_anchors.py          # Dry-run preview
    uv run python scripts/clean_dirty_ga_anchors.py --apply  # Execute deletion
"""

from dotenv import load_dotenv

load_dotenv()

import argparse
import asyncio
import sys

from open_notebook.domain.ga_anchor_cache import GaAnchorCache


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clean dirty records from ga_anchor_cache table."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply deletions to database (default is dry-run preview).",
    )
    args = parser.parse_args()

    mode = "EXECUTE (APPLY)" if args.apply else "PREVIEW (DRY-RUN)"
    print(f"=== ga_anchor_cache Dirty Records Cleanup [{mode}] ===\n")

    result = await GaAnchorCache.cleanup_dirty_records(apply=args.apply)

    scanned = result["scanned"]
    dirty_count = result["dirty_count"]
    deleted_count = result["deleted_count"]
    dirty_records = result["dirty_records"]

    print(f"Total records scanned: {scanned}")
    print(f"Dirty records found:   {dirty_count}")
    if args.apply:
        print(f"Records deleted:       {deleted_count}")

    if result.get("error"):
        print(f"\n[ERROR] Database operation failed: {result['error']}")
        print("Please ensure SurrealDB is running and credentials in .env are correct.")
        return 1

    if dirty_records:
        print("\nDirty records details:")
        for r in dirty_records:
            print(
                f"  - [{r.get('id') or 'N/A'}] tech: {r.get('tech')!r}, "
                f"version: {r.get('version')!r}, ga: {r.get('ga')!r} => {r.get('reason')}"
            )
    else:
        print("\nNo dirty records found in ga_anchor_cache.")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
