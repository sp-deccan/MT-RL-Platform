from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import HTTPException

# Block obvious write / DDL patterns (dev tool; not a full SQL parser).
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|truncate|alter|attach|detach|pragma|"
    r"vacuum|replace\s+into|create\s+table|create\s+index)\b",
    re.IGNORECASE | re.DOTALL,
)


def _connect(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise HTTPException(404, f"Database file not found: {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def list_tables(db_path: Path) -> list[dict[str, Any]]:
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
        out = []
        for r in rows:
            name = r[0]
            cnt = conn.execute(f'SELECT COUNT(*) AS c FROM "{name}"').fetchone()[0]
            out.append({"name": name, "row_count": cnt})
        return out
    finally:
        conn.close()


def table_columns(db_path: Path, table: str) -> list[dict[str, Any]]:
    _assert_safe_identifier(table)
    conn = _connect(db_path)
    try:
        cur = conn.execute(f'PRAGMA table_info("{table}")')
        cols = []
        for row in cur.fetchall():
            cols.append(
                {
                    "cid": row[0],
                    "name": row[1],
                    "type": row[2],
                    "notnull": bool(row[3]),
                    "default": row[4],
                    "pk": bool(row[5]),
                }
            )
        return cols
    finally:
        conn.close()


def table_rows(
    db_path: Path, table: str, limit: int = 100, offset: int = 0
) -> dict[str, Any]:
    _assert_safe_identifier(table)
    lim = max(1, min(limit, 500))
    off = max(0, offset)
    conn = _connect(db_path)
    try:
        total = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        cur = conn.execute(
            f'SELECT * FROM "{table}" LIMIT ? OFFSET ?', (lim, off)
        )
        rows = [dict(r) for r in cur.fetchall()]
        colnames = (
            list(rows[0].keys())
            if rows
            else ([d[0] for d in cur.description] if cur.description else [])
        )
        if not colnames:
            colnames = [c["name"] for c in table_columns(db_path, table)]
        return {
            "table": table,
            "columns": colnames,
            "rows": rows,
            "total": total,
            "limit": lim,
            "offset": off,
        }
    finally:
        conn.close()


def _assert_safe_identifier(table: str) -> None:
    if not table or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", table):
        raise HTTPException(400, "Invalid table name")


def validate_readonly_sql(sql: str) -> str:
    raw = (sql or "").strip()
    if not raw:
        raise HTTPException(400, "SQL is empty")
    # Single statement: no semicolon except optional terminator.
    core = raw.rstrip().rstrip(";").strip()
    if ";" in core:
        raise HTTPException(
            400, "Only one SQL statement is allowed; remove embedded semicolons.",
        )
    stmt = raw.rstrip().rstrip(";").strip()
    low = stmt.lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise HTTPException(
            400, "Only read-only SELECT (or WITH … SELECT) queries are allowed.",
        )
    if _FORBIDDEN.search(stmt):
        raise HTTPException(400, "Query contains forbidden keywords for this explorer.")
    return stmt


def run_select(
    db_path: Path, sql: str, max_rows: int = 500
) -> dict[str, Any]:
    stmt = validate_readonly_sql(sql)
    cap = max(1, min(max_rows, 1000))
    conn = _connect(db_path)
    try:
        cur = conn.execute(stmt)
        desc = cur.description
        columns = [d[0] for d in desc] if desc else []
        rows: list[dict[str, Any]] = []
        truncated = False
        for i, row in enumerate(cur):
            if i >= cap:
                truncated = True
                break
            rows.append(dict(row))
        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "max_rows": cap,
        }
    except sqlite3.Error as e:
        raise HTTPException(400, f"SQLite error: {e}") from e
    finally:
        conn.close()
