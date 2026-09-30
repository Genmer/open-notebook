from typing import Any, Dict, List, Optional

from loguru import logger
from surreal_commands import get_command_status, submit_command

from api.explain_service import RETRYABLE_COMMANDS, _recovery_status
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.exceptions import ConflictError, InvalidInputError, NotFoundError


class CommandService:
    """Generic service layer for command operations"""

    @staticmethod
    async def submit_command_job(
        module_name: str,  # Actually app_name for surreal-commands
        command_name: str,
        command_args: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Submit a generic command job for background processing"""
        try:
            # Ensure command modules are imported before submitting
            # This is needed because submit_command validates against local registry
            try:
                import commands.artifact_commands  # noqa: F401
                import commands.classification_commands  # noqa: F401
                import commands.data_transfer_commands  # noqa: F401
                import commands.podcast_commands  # noqa: F401
            except ImportError as import_err:
                logger.error(f"Failed to import command modules: {import_err}")
                raise ValueError("Command modules not available")

            # surreal-commands expects: submit_command(app_name, command_name, args)
            cmd_id = submit_command(
                module_name,  # This is actually the app name (e.g., "open_notebook")
                command_name,  # Command name (e.g., "generate_podcast")
                command_args,  # Input data
            )
            # Convert RecordID to string if needed
            if not cmd_id:
                raise ValueError("Failed to get cmd_id from submit_command")
            cmd_id_str = str(cmd_id)
            logger.info(
                f"Submitted command job: {cmd_id_str} for {module_name}.{command_name}"
            )
            return cmd_id_str

        except Exception as e:
            logger.error(f"Failed to submit command job: {e}")
            raise

    @staticmethod
    async def get_command_status(job_id: str) -> Dict[str, Any]:
        """Get status of any command job"""
        try:
            status = await get_command_status(job_id)
            return {
                "job_id": job_id,
                "status": status.status if status else "unknown",
                "result": status.result if status else None,
                "error_message": getattr(status, "error_message", None)
                if status
                else None,
                "created": str(status.created)
                if status and hasattr(status, "created") and status.created
                else None,
                "updated": str(status.updated)
                if status and hasattr(status, "updated") and status.updated
                else None,
                "progress": getattr(status, "progress", None) if status else None,
            }
        except Exception as e:
            logger.error(f"Failed to get command status: {e}")
            raise

    @staticmethod
    async def get_live_progress(job_id: str) -> Dict[str, Any]:
        """Get live progress telemetry for a command job"""
        from api.task_service import get_live_progress

        return await get_live_progress(job_id)

    @staticmethod
    async def list_command_jobs(
        module_filter: Optional[str] = None,
        command_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """List command jobs with optional filtering"""
        # This will be implemented with proper SurrealDB queries
        # For now, return empty list as this is foundation phase
        return []

    @staticmethod
    async def cancel_command_job(job_id: str) -> bool:
        """Mark a pending/running command row canceled.

        surreal-commands has no cancellation protocol: this removes `new`
        rows from the worker queue and clears orphaned `running` rows; a
        task genuinely executing in a worker will overwrite the status with
        its final result when it finishes. The UPDATE is status-guarded so a
        job that finishes between the SELECT and the UPDATE can never be
        rewritten as canceled.
        """
        try:
            rid = ensure_record_id(job_id)
            rows = await repo_query(
                "SELECT status FROM command WHERE id = $id", {"id": rid}
            )
            if not rows:
                raise NotFoundError(f"Command job {job_id} not found")
            status = str(rows[0].get("status") or "")
            if status in ("completed", "failed", "canceled"):
                raise ConflictError(f"Command job already {status}")
            updated = await repo_query(
                "UPDATE command SET status = 'canceled', "
                "error_message = $msg, updated = time::now() "
                "WHERE id = $id AND status NOT IN ['completed', 'failed', 'canceled'] "
                "RETURN status",
                {"id": rid, "msg": "Canceled from Task Center"},
            )
            if not updated:
                raise ConflictError(f"Command job {job_id} already finished")
            logger.info(f"Canceled command job {job_id} (was {status})")
            return True
        except (NotFoundError, ConflictError):
            raise
        except Exception as e:
            logger.error(f"Failed to cancel command job: {e}")
            raise

    @staticmethod
    async def retry_command_job(
        job_id: str, check_recovery: bool = False
    ) -> Dict[str, Any]:
        """Replay a command's original args as a NEW job; the old row stays as history.

        With check_recovery=True the replay is skipped when the affected entity
        has already recovered; an undeterminable recovery status (None) still
        replays — better a redundant retry than a skipped fix.
        """
        try:
            rid = ensure_record_id(job_id)
            rows = await repo_query(
                "SELECT name, args FROM command WHERE id = $id", {"id": rid}
            )
            if not rows:
                raise NotFoundError(f"Command job {job_id} not found")
            name = str(rows[0].get("name") or "")
            if name not in RETRYABLE_COMMANDS:
                raise InvalidInputError(f"Command '{name}' is not retryable")
            args = rows[0].get("args") or {}
            if check_recovery:
                recovery = await _recovery_status(name, args)
                if recovery and recovery.get("recovered"):
                    detail = str(recovery.get("detail") or "")
                    logger.info(
                        f"Skipped retry of command job {job_id} ({name}): {detail}"
                    )
                    return {
                        "job_id": None,
                        "status": "skipped_recovered",
                        "message": f"Already recovered: {detail}",
                    }
            new_job_id = await CommandService.submit_command_job(
                "open_notebook", name, args
            )
            logger.info(f"Retried command job {job_id} ({name}) as {new_job_id}")
            return {
                "job_id": new_job_id,
                "status": "submitted",
                "message": f"Command '{name}' re-submitted successfully",
            }
        except (NotFoundError, InvalidInputError):
            raise
        except Exception as e:
            logger.error(f"Failed to retry command job {job_id}: {e}")
            raise
