from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path


class JiraStore:
    """SQLite-backed JIRA-shaped store (projects, issues, comments)."""

    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema_and_seed()

    @property
    def path(self) -> Path:
        """Absolute path to this store's SQLite file."""
        return self._path.resolve()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self._path, check_same_thread=False)
        c.row_factory = sqlite3.Row
        return c

    def _init_schema_and_seed(self) -> None:
        with self._lock:
            c = self._conn()
            try:
                c.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS projects (
                        key TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        project_type TEXT DEFAULT 'software'
                    );
                    CREATE TABLE IF NOT EXISTS issues (
                        key TEXT PRIMARY KEY,
                        project_key TEXT NOT NULL,
                        summary TEXT NOT NULL,
                        description TEXT,
                        status TEXT NOT NULL,
                        issue_type TEXT NOT NULL,
                        assignee TEXT,
                        priority TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (project_key) REFERENCES projects(key)
                    );
                    CREATE TABLE IF NOT EXISTS comments (
                        id TEXT PRIMARY KEY,
                        issue_key TEXT NOT NULL,
                        author TEXT NOT NULL,
                        body TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (issue_key) REFERENCES issues(key)
                    );
                    CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_key);
                    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
                    """
                )
                cur = c.execute("SELECT COUNT(*) FROM projects")
                if cur.fetchone()[0] == 0:
                    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    projects = [
                        ("RL", "RL Platform", "software"),
                        ("DEMO", "Demo Space", "software"),
                        ("ORD", "Orders", "business"),
                        ("INV", "Inventory", "software"),
                    ]
                    c.executemany(
                        "INSERT INTO projects (key, name, project_type) VALUES (?,?,?)",
                        projects,
                    )
                    issues = [
                        (
                            "RL-1",
                            "RL",
                            "Wire LangChain tool-calling agent",
                            "Hook GPT to SQLite JIRA tools.",
                            "In Progress",
                            "Task",
                            "alice",
                            "High",
                            now,
                            now,
                        ),
                        (
                            "RL-2",
                            "RL",
                            "Add RLHF ranking UI",
                            "Compare trajectory A vs B.",
                            "To Do",
                            "Story",
                            None,
                            "Medium",
                            now,
                            now,
                        ),
                        (
                            "DEMO-1",
                            "DEMO",
                            "Sample bug in checkout",
                            "Payment fails on retry.",
                            "To Do",
                            "Bug",
                            "bob",
                            "Highest",
                            now,
                            now,
                        ),
                        (
                            "ORD-10",
                            "ORD",
                            "Backfill order metadata",
                            None,
                            "Done",
                            "Task",
                            "carol",
                            "Low",
                            now,
                            now,
                        ),
                    ]
                    c.executemany(
                        """
                        INSERT INTO issues (key, project_key, summary, description, status,
                          issue_type, assignee, priority, created_at, updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?)
                        """,
                        issues,
                    )
                    c.execute(
                        """
                        INSERT INTO comments (id, issue_key, author, body, created_at)
                        VALUES (?,?,?,?,?)
                        """,
                        (
                            str(uuid.uuid4()),
                            "RL-1",
                            "alice",
                            "Started OpenAI binding.",
                            now,
                        ),
                    )
                c.commit()
            finally:
                c.close()

    def list_projects(self) -> list[dict[str, str]]:
        with self._lock:
            c = self._conn()
            try:
                rows = c.execute(
                    "SELECT key, name, project_type FROM projects ORDER BY key"
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                c.close()

    def get_project(self, key: str) -> dict[str, object] | None:
        with self._lock:
            c = self._conn()
            try:
                row = c.execute(
                    "SELECT key, name, project_type FROM projects WHERE key = ?",
                    (key.upper(),),
                ).fetchone()
                if not row:
                    return None
                cnt = c.execute(
                    "SELECT COUNT(*) FROM issues WHERE project_key = ?",
                    (key.upper(),),
                ).fetchone()[0]
                d = dict(row)
                d["open_issues"] = cnt
                return d
            finally:
                c.close()

    def search_issues(
        self,
        text: str | None = None,
        project_key: str | None = None,
        status: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, object]]:
        q = "SELECT key, project_key, summary, status, issue_type, assignee, priority FROM issues WHERE 1=1"
        params: list[object] = []
        if project_key:
            q += " AND project_key = ?"
            params.append(project_key.upper())
        if status:
            q += " AND lower(status) = lower(?)"
            params.append(status)
        if text:
            q += " AND (summary LIKE ? OR IFNULL(description,'') LIKE ?)"
            like = f"%{text}%"
            params.extend([like, like])
        q += f" ORDER BY key LIMIT {max(1, min(limit, 50))}"
        with self._lock:
            c = self._conn()
            try:
                rows = c.execute(q, params).fetchall()
                return [dict(r) for r in rows]
            finally:
                c.close()

    def get_issue(self, issue_key: str) -> dict[str, object] | None:
        with self._lock:
            c = self._conn()
            try:
                row = c.execute(
                    "SELECT * FROM issues WHERE key = ?", (issue_key.upper(),)
                ).fetchone()
                return dict(row) if row else None
            finally:
                c.close()

    def _next_issue_key(self, c: sqlite3.Connection, project_key: str) -> str:
        pk = project_key.upper()
        row = c.execute(
            "SELECT key FROM issues WHERE project_key = ? ORDER BY key DESC LIMIT 1",
            (pk,),
        ).fetchone()
        if not row:
            n = 1
        else:
            part = row[0].split("-")[-1]
            try:
                n = int(part) + 1
            except ValueError:
                n = 1
        return f"{pk}-{n}"

    def create_issue(
        self,
        project_key: str,
        summary: str,
        issue_type: str = "Task",
        description: str | None = None,
        status: str = "To Do",
        assignee: str | None = None,
        priority: str = "Medium",
    ) -> dict[str, object]:
        pk = project_key.upper()
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with self._lock:
            c = self._conn()
            try:
                pr = c.execute(
                    "SELECT key FROM projects WHERE key = ?", (pk,)
                ).fetchone()
                if not pr:
                    return {"error": f"Unknown project: {pk}"}
                key = self._next_issue_key(c, pk)
                c.execute(
                    """
                    INSERT INTO issues (key, project_key, summary, description, status,
                      issue_type, assignee, priority, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        key,
                        pk,
                        summary,
                        description,
                        status,
                        issue_type,
                        assignee,
                        priority,
                        now,
                        now,
                    ),
                )
                c.commit()
                return {"created": True, "key": key, "project_key": pk}
            finally:
                c.close()

    def update_issue(
        self,
        issue_key: str,
        summary: str | None = None,
        description: str | None = None,
        assignee: str | None = None,
        priority: str | None = None,
    ) -> dict[str, object]:
        ik = issue_key.upper()
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        fields: list[str] = []
        params: list[object] = []
        if summary is not None:
            fields.append("summary = ?")
            params.append(summary)
        if description is not None:
            fields.append("description = ?")
            params.append(description)
        if assignee is not None:
            fields.append("assignee = ?")
            params.append(assignee)
        if priority is not None:
            fields.append("priority = ?")
            params.append(priority)
        if not fields:
            return {"error": "No fields to update"}
        params.append(ik)
        with self._lock:
            c = self._conn()
            try:
                cur = c.execute(
                    f"UPDATE issues SET {', '.join(fields)}, updated_at = ? WHERE key = ?",
                    [*params[:-1], now, ik],
                )
                c.commit()
                if cur.rowcount == 0:
                    return {"error": f"Issue not found: {ik}"}
                return {"updated": True, "key": ik}
            finally:
                c.close()

    def delete_issue(self, issue_key: str) -> dict[str, object]:
        ik = issue_key.upper()
        with self._lock:
            c = self._conn()
            try:
                c.execute("DELETE FROM comments WHERE issue_key = ?", (ik,))
                cur = c.execute("DELETE FROM issues WHERE key = ?", (ik,))
                c.commit()
                if cur.rowcount == 0:
                    return {"error": f"Issue not found: {ik}"}
                return {"deleted": True, "key": ik}
            finally:
                c.close()

    def add_comment(self, issue_key: str, author: str, body: str) -> dict[str, object]:
        ik = issue_key.upper()
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        cid = str(uuid.uuid4())
        with self._lock:
            c = self._conn()
            try:
                exists = c.execute(
                    "SELECT key FROM issues WHERE key = ?", (ik,)
                ).fetchone()
                if not exists:
                    return {"error": f"Issue not found: {ik}"}
                c.execute(
                    """
                    INSERT INTO comments (id, issue_key, author, body, created_at)
                    VALUES (?,?,?,?,?)
                    """,
                    (cid, ik, author, body, now),
                )
                c.execute(
                    "UPDATE issues SET updated_at = ? WHERE key = ?", (now, ik)
                )
                c.commit()
                return {"comment_id": cid, "issue_key": ik}
            finally:
                c.close()

    def list_comments(self, issue_key: str) -> list[dict[str, object]]:
        ik = issue_key.upper()
        with self._lock:
            c = self._conn()
            try:
                rows = c.execute(
                    "SELECT id, author, body, created_at FROM comments WHERE issue_key = ? ORDER BY created_at",
                    (ik,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                c.close()

    def transition_issue(self, issue_key: str, new_status: str) -> dict[str, object]:
        ik = issue_key.upper()
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        allowed = {"To Do", "In Progress", "Done", "Blocked"}
        if new_status not in allowed:
            return {
                "error": f"Invalid status '{new_status}'. Use one of: {sorted(allowed)}"
            }
        with self._lock:
            c = self._conn()
            try:
                cur = c.execute(
                    "UPDATE issues SET status = ?, updated_at = ? WHERE key = ?",
                    (new_status, now, ik),
                )
                c.commit()
                if cur.rowcount == 0:
                    return {"error": f"Issue not found: {ik}"}
                return {"transitioned": True, "key": ik, "status": new_status}
            finally:
                c.close()

    def dump_snapshot_json(self) -> str:
        """Small context blob for the LLM (not full DB)."""
        data = {
            "projects": self.list_projects(),
            "recent_issues": self.search_issues(limit=15),
        }
        return json.dumps(data, indent=2)
