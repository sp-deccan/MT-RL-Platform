from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Any, Literal

from backend.jira_store import JiraStore
from backend.settings import REPO_ROOT

log = logging.getLogger(__name__)

_SID_RE = re.compile(r"^[a-zA-Z0-9_-]{8,128}$")

"""Which logical SQLite file within an RL session (trajectory A, B, or ideal edits)."""
JiraDbFork = Literal["A", "B", "ideal"]


def parse_db_fork_header(raw: str) -> JiraDbFork:
    v = raw.strip().lower()
    if v == "a":
        return "A"
    if v == "b":
        return "B"
    if v == "ideal":
        return "ideal"
    raise ValueError(f"Invalid X-RL-Db-Fork {raw!r}; expected A, B, or ideal")


def validate_session_id(raw: str) -> str:
    s = raw.strip()
    if not _SID_RE.match(s):
        raise ValueError(
            "Session id must be 8–128 chars of letters, digits, underscore, hyphen"
        )
    return s


def sessions_dir_from_config(config: dict[str, Any]) -> Path:
    jd = config.get("jira_db") or {}
    rel = jd.get("sessions_dir", "data/sessions")
    return (REPO_ROOT / str(rel)).resolve()


class SessionJiraRegistry:
    """
    Per browser RL session: three isolated SQLite files (trajectory A, B, ideal).

    Legacy single file ``<session_id>.sqlite3`` is removed on reset for cleanliness.
    """

    def __init__(self, root: Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._cache: dict[tuple[str, JiraDbFork], JiraStore] = {}

    def db_path(self, session_id: str, fork: JiraDbFork) -> Path:
        sid = validate_session_id(session_id)
        return (self._root / f"{sid}_{fork}.sqlite3").resolve()

    def legacy_db_path(self, session_id: str) -> Path:
        """Pre-fork layout: one DB per session (deprecated)."""
        sid = validate_session_id(session_id)
        return (self._root / f"{sid}.sqlite3").resolve()

    def get_store(self, session_id: str, fork: JiraDbFork) -> JiraStore:
        sid = validate_session_id(session_id)
        key = (sid, fork)
        with self._lock:
            st = self._cache.get(key)
            if st is None:
                st = JiraStore(self.db_path(sid, fork))
                self._cache[key] = st
            return st

    def reset_fork(self, session_id: str, fork: JiraDbFork) -> None:
        """Remove one fork's file and cache entry (next get_store re-seeds)."""
        sid = validate_session_id(session_id)
        with self._lock:
            self._cache.pop((sid, fork), None)
        path = self.db_path(sid, fork)
        try:
            if path.is_file():
                path.unlink()
        except OSError as e:
            log.warning("Could not remove session DB %s: %s", path, e)

    def reset(self, session_id: str) -> None:
        """Drop cached handles and delete all fork DB files (and legacy file) for this session."""
        sid = validate_session_id(session_id)
        with self._lock:
            drop = [k for k in list(self._cache.keys()) if k[0] == sid]
            for k in drop:
                self._cache.pop(k, None)
        paths = [
            self.db_path(sid, "A"),
            self.db_path(sid, "B"),
            self.db_path(sid, "ideal"),
            self.legacy_db_path(sid),
        ]
        for path in paths:
            try:
                if path.is_file():
                    path.unlink()
            except OSError as e:
                log.warning("Could not remove session DB %s: %s", path, e)
