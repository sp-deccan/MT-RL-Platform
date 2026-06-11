export type DbTableInfo = { name: string; row_count: number }

export type DbColumnInfo = {
  cid: number
  name: string
  type: string
  notnull: boolean
  default: unknown
  pk: boolean
}

export type DbTableRowsResponse = {
  table: string
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  limit: number
  offset: number
}

export type DbQueryResponse = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  truncated: boolean
  max_rows: number
}

import { type RlDbFork, rlSessionHeaders } from './rlSession'

async function parseError(r: Response): Promise<string> {
  const t = await r.text()
  try {
    const j = JSON.parse(t) as { detail?: string | unknown }
    if (typeof j.detail === 'string') return j.detail
  } catch {
    /* ignore */
  }
  return t || `HTTP ${r.status}`
}

export type DbTablesListResponse = {
  tables: DbTableInfo[]
  db_fork?: string
  db_path?: string
}

export async function fetchDbTables(
  fork: RlDbFork,
): Promise<DbTablesListResponse> {
  const r = await fetch('/api/db/tables', { headers: rlSessionHeaders(fork) })
  if (!r.ok) throw new Error(await parseError(r))
  return (await r.json()) as DbTablesListResponse
}

export async function fetchDbTableColumns(
  table: string,
  fork: RlDbFork,
): Promise<DbColumnInfo[]> {
  const r = await fetch(
    `/api/db/tables/${encodeURIComponent(table)}/columns`,
    { headers: rlSessionHeaders(fork) },
  )
  if (!r.ok) throw new Error(await parseError(r))
  const j = (await r.json()) as { columns: DbColumnInfo[] }
  return j.columns ?? []
}

export async function fetchDbTableRows(
  table: string,
  fork: RlDbFork,
  limit = 100,
  offset = 0,
): Promise<DbTableRowsResponse> {
  const q = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  const r = await fetch(
    `/api/db/tables/${encodeURIComponent(table)}/rows?${q}`,
    { headers: rlSessionHeaders(fork) },
  )
  if (!r.ok) throw new Error(await parseError(r))
  return (await r.json()) as DbTableRowsResponse
}

export async function runDbQuery(
  sql: string,
  fork: RlDbFork,
  maxRows = 500,
): Promise<DbQueryResponse> {
  const r = await fetch('/api/db/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...rlSessionHeaders(fork),
    },
    body: JSON.stringify({ sql, max_rows: maxRows }),
  })
  if (!r.ok) throw new Error(await parseError(r))
  return (await r.json()) as DbQueryResponse
}
