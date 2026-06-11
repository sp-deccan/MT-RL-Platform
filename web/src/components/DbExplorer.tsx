import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react'
import {
  fetchDbTableRows,
  fetchDbTables,
  runDbQuery,
  type DbColumnInfo,
  type DbQueryResponse,
  type DbTableInfo,
  type DbTableRowsResponse,
} from '../lib/dbApi'
import type { RlDbFork } from '../lib/rlSession'

const FORKS: { id: RlDbFork; title: string; description: string }[] = [
  {
    id: 'A',
    title: 'Database · response A',
    description:
      'Mutations from the trajectory A agent run only. Unchanged when you edit B or ideal.',
  },
  {
    id: 'B',
    title: 'Database · response B',
    description:
      'Mutations from the trajectory B agent run only. Same seed as A at generate time, separate file.',
  },
  {
    id: 'ideal',
    title: 'Database · ideal trajectory',
    description:
      'Mutations from “Run step” in section 3 only. Does not affect A or B.',
  },
]

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function DbForkPanel({
  fork,
  title,
  description,
  reloadSignal = 0,
}: {
  fork: RlDbFork
  title: string
  description: string
  /** When incremented, refetch tables if this panel was ever opened (e.g. after dummy replay). */
  reloadSignal?: number
}) {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dbPathHint, setDbPathHint] = useState<string | null>(null)
  const [tables, setTables] = useState<DbTableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [columns, setColumns] = useState<DbColumnInfo[]>([])
  const [preview, setPreview] = useState<DbTableRowsResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sql, setSql] = useState('SELECT * FROM issues LIMIT 50')
  const [queryResult, setQueryResult] = useState<DbQueryResponse | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const everOpenedRef = useRef(false)

  const refreshTables = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetchDbTables(fork)
      setDbPathHint(res.db_path ?? null)
      const list = res.tables ?? []
      setTables(list)
      if (list.length) {
        const name = list[0]!.name
        setSelectedTable(name)
        const data = await fetchDbTableRows(name, fork, 100, 0)
        setPreview(data)
        setColumns(
          data.columns.map((col, i) => ({
            cid: i,
            name: col,
            type: '',
            notnull: false,
            default: null,
            pk: false,
          })),
        )
      } else {
        setSelectedTable(null)
        setPreview(null)
        setColumns([])
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setTables([])
    }
  }, [fork])

  const loadPreview = useCallback(
    async (table: string) => {
      setPreviewLoading(true)
      setLoadError(null)
      try {
        const data = await fetchDbTableRows(table, fork, 100, 0)
        setPreview(data)
        setColumns(
          data.columns.map((name, i) => ({
            cid: i,
            name,
            type: '',
            notnull: false,
            default: null,
            pk: false,
          })),
        )
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e))
        setPreview(null)
      } finally {
        setPreviewLoading(false)
      }
    },
    [fork],
  )

  useEffect(() => {
    if (reloadSignal === 0) return
    if (!everOpenedRef.current) return
    void refreshTables()
  }, [reloadSignal, refreshTables])

  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open) return
    if (!everOpenedRef.current) {
      everOpenedRef.current = true
      void refreshTables()
    }
  }

  const onPickTable = (name: string) => {
    setSelectedTable(name)
    void loadPreview(name)
  }

  const runSql = async () => {
    setQueryError(null)
    setQueryResult(null)
    setQueryLoading(true)
    try {
      const res = await runDbQuery(sql, fork, 500)
      setQueryResult(res)
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : String(e))
    } finally {
      setQueryLoading(false)
    }
  }

  return (
    <details
      className="rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-950/40"
      onToggle={onToggle}
    >
      <summary className="cursor-pointer list-none px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-violet-800 dark:bg-violet-950 dark:text-violet-300">
            fork: {fork}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      </summary>

      <div className="border-t border-zinc-200 px-4 pb-4 pt-2 dark:border-zinc-700">
        {dbPathHint ? (
          <p className="mb-2 break-all font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            {dbPathHint}
          </p>
        ) : null}
        {loadError ? (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 pb-3">
          <button
            type="button"
            onClick={() => void refreshTables()}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-zinc-600 dark:bg-zinc-900"
          >
            Refresh tables
          </button>
          {selectedTable ? (
            <button
              type="button"
              onClick={() => void loadPreview(selectedTable)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-zinc-600 dark:bg-zinc-900"
            >
              Reload “{selectedTable}” preview
            </button>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Tables
            </h3>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              {tables.length === 0 && !loadError ? (
                <p className="p-3 text-sm text-zinc-500">
                  Expand this section once to load, or click Refresh.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {tables.map((t) => (
                    <li key={t.name}>
                      <button
                        type="button"
                        onClick={() => onPickTable(t.name)}
                        className={
                          selectedTable === t.name
                            ? 'flex w-full items-center justify-between bg-violet-100/80 px-3 py-2 text-left text-sm dark:bg-violet-950/40'
                            : 'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }
                      >
                        <span className="font-mono text-xs">{t.name}</span>
                        <span className="text-xs text-zinc-500">
                          {t.row_count} rows
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Column preview
            </h3>
            {columns.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {columns.map((c) => (
                  <li
                    key={c.name}
                    className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {c.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">Pick a table to see columns.</p>
            )}

            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Records ({selectedTable ?? '—'})
            </h3>
            {previewLoading ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : preview && preview.columns.length ? (
              <div className="max-h-64 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
                    <tr>
                      {preview.columns.map((col) => (
                        <th
                          key={col}
                          className="whitespace-nowrap px-2 py-1 font-medium"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        {preview.columns.map((col) => (
                          <td
                            key={col}
                            className="max-w-[200px] truncate px-2 py-1 font-mono text-zinc-800 dark:text-zinc-200"
                            title={formatCell(row[col])}
                          >
                            {formatCell(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-zinc-100 px-2 py-1 text-[11px] text-zinc-500 dark:border-zinc-800">
                  Showing {preview.rows.length} of {preview.total} rows (limit{' '}
                  {preview.limit})
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No preview yet.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              SQL query (SELECT only)
            </h3>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={6}
              className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed dark:border-zinc-600 dark:bg-zinc-900"
              spellCheck={false}
            />
            <button
              type="button"
              disabled={queryLoading}
              onClick={() => void runSql()}
              className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-violet-600"
            >
              {queryLoading ? 'Running…' : 'Run query'}
            </button>
            {queryError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {queryError}
              </p>
            ) : null}
            {queryResult ? (
              <div className="mt-3">
                <p className="mb-1 text-[11px] text-zinc-500">
                  {queryResult.row_count} row(s)
                  {queryResult.truncated
                    ? ` (truncated at ${queryResult.max_rows})`
                    : ''}
                </p>
                <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
                      <tr>
                        {queryResult.columns.map((col) => (
                          <th
                            key={col}
                            className="whitespace-nowrap px-2 py-1 font-medium"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows.map((row, ri) => (
                        <tr
                          key={ri}
                          className="border-t border-zinc-100 dark:border-zinc-800"
                        >
                          {queryResult.columns.map((col) => (
                            <td
                              key={col}
                              className="max-w-[220px] truncate px-2 py-1 font-mono text-zinc-800 dark:text-zinc-200"
                              title={formatCell(row[col])}
                            >
                              {formatCell(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  )
}

export function DbExplorer({ reloadSignal = 0 }: { reloadSignal?: number } = {}) {
  return (
    <details className="rounded-2xl border border-zinc-200 bg-white/80 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/80">
      <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-zinc-900 marker:hidden dark:text-zinc-100 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          <span>JIRA SQLite · three isolated databases</span>
          <span className="text-xs font-normal text-zinc-500">
            Expand · A, B, ideal
          </span>
        </span>
        <p className="mt-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
          Each fork is a separate file under{' '}
          <code className="text-[11px]">data/sessions/</code>. Open a section to
          browse tables and run read-only SQL for that fork only.
        </p>
      </summary>

      <div className="space-y-3 border-t border-zinc-100 px-5 pb-5 pt-4 dark:border-zinc-800">
        {FORKS.map((f) => (
          <DbForkPanel
            key={f.id}
            fork={f.id}
            title={f.title}
            description={f.description}
            reloadSignal={reloadSignal}
          />
        ))}
      </div>
    </details>
  )
}
