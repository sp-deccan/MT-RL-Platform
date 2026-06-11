import { useCallback, useEffect, useState } from 'react'
import {
  DATABASES,
  RLHF_COMPARISON_INTRO,
  RLHF_OVERALL_SCALE_LABELS,
} from '../constants'
import { fetchDbTables, type DbTableInfo } from '../lib/dbApi'
import type { RlDbFork } from '../lib/rlSession'
import type { IdealTurnDraft } from '../lib/idealStorage'
import { emptyIdealTurn } from '../lib/idealStorage'
import type { VerifierTurnDraft } from '../lib/verifierTurns'
import { emptyVerifierTurn } from '../lib/verifierTurns'
import type { MetadataRow, Trajectory } from '../types'
import type {
  QcReviewState,
  QcRlhfIssueLevel,
  QcRlhfRubrics,
} from '../types/qc'
import type { TaskMetadata } from '../lib/taskMetadata'
import { DbExplorer } from './DbExplorer'
import { TaskMetadataFields } from './TaskMetadataFields'
import { RecommendedToolsPanel } from './RecommendedToolsPanel'
import { TrajectoryTurnPanel } from './TrajectoryTurnPanel'
import { TurnNavigationBar } from './TurnNavigationBar'

const RLHF_ISSUE_LABELS: { id: QcRlhfIssueLevel; label: string }[] = [
  { id: 'no_issue', label: 'No issue' },
  { id: 'minor_issue', label: 'Minor issue' },
  { id: 'major_issue', label: 'Major issue' },
]

function QcSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/80">
      <div className="mb-4 border-b border-zinc-100 pb-3 dark:border-zinc-800">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function QcRlhfReadonlyBlock({
  title,
  level,
  rationale,
}: {
  title: string
  level: QcRlhfIssueLevel | null
  rationale: string
}) {
  const label =
    level == null
      ? '—'
      : (RLHF_ISSUE_LABELS.find((o) => o.id === level)?.label ?? level)
  return (
    <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
        {title}
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Annotator rubric: <span className="font-medium">{label}</span>
      </p>
      {rationale.trim() ? (
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {rationale}
        </p>
      ) : null}
    </div>
  )
}

function QcRatingDimension({
  title,
  hint,
  value,
  onValue,
  rationale,
  onRationale,
}: {
  title: string
  hint?: string
  value: number | null
  onValue: (n: number | null) => void
  rationale: string
  onRationale: (s: string) => void
}) {
  return (
    <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="mb-2">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        ) : null}
      </div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        Rating (1–5)
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([1, 2, 3, 4, 5] as const).map((n) => {
          const on = value === n
          return (
            <button
              key={n}
              type="button"
              onClick={() => onValue(value === n ? null : n)}
              className={
                on
                  ? 'min-w-[2.25rem] rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white'
                  : 'min-w-[2.25rem] rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-violet-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
              }
            >
              {n}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => onValue(null)}
          className="rounded-lg px-2 py-1 text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Clear
        </button>
      </div>
      <label className="mb-1 block text-[11px] font-medium text-zinc-500">
        Justification / notes
      </label>
      <textarea
        value={rationale}
        onChange={(e) => onRationale(e.target.value)}
        rows={3}
        placeholder="QC rationale for this dimension…"
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs leading-relaxed text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
      />
    </div>
  )
}

function DbSnapshotStrip({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    forks: Partial<
      Record<RlDbFork, { db_path?: string; tables: DbTableInfo[] }>
    >
  }>({ loading: true, error: null, forks: {} })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [a, b, ideal] = await Promise.all([
        fetchDbTables('A'),
        fetchDbTables('B'),
        fetchDbTables('ideal'),
      ])
      setState({
        loading: false,
        error: null,
        forks: {
          A: { db_path: a.db_path, tables: a.tables ?? [] },
          B: { db_path: b.db_path, tables: b.tables ?? [] },
          ideal: { db_path: ideal.db_path, tables: ideal.tables ?? [] },
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setState({ loading: false, error: msg, forks: {} })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const forkMeta: { id: RlDbFork; label: string }[] = [
    { id: 'A', label: 'Response A' },
    { id: 'B', label: 'Response B' },
    { id: 'ideal', label: 'Ideal' },
  ]

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Database snapshot (read-only)
        </h3>
        <button
          type="button"
          disabled={state.loading}
          onClick={() => void load()}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900"
        >
          {state.loading ? 'Refreshing…' : 'Refresh snapshot'}
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Row counts per table for each session fork. Use the explorer below for
        SELECT-only SQL.
      </p>
      {state.error ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Could not load snapshot (is the backend running?). {state.error}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {forkMeta.map(({ id, label }) => {
            const f = state.forks[id]
            return (
              <div
                key={id}
                className="rounded-lg border border-zinc-200 bg-white/90 p-3 text-xs dark:border-zinc-600 dark:bg-zinc-950/50"
              >
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {label}
                </p>
                {f?.db_path ? (
                  <p className="mt-1 break-all font-mono text-[10px] text-zinc-500">
                    {f.db_path}
                  </p>
                ) : null}
                <ul className="mt-2 space-y-0.5 text-zinc-600 dark:text-zinc-400">
                  {(f?.tables ?? []).map((t) => (
                    <li key={t.name}>
                      <span className="font-mono">{t.name}</span>
                      <span className="text-zinc-400"> · </span>
                      {t.row_count} rows
                    </li>
                  ))}
                  {!state.loading && (f?.tables?.length ?? 0) === 0 ? (
                    <li className="text-zinc-400">No tables</li>
                  ) : null}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type QcWorkspaceProps = {
  metadataRows: MetadataRow[]
  taskMetadata: TaskMetadata
  databaseId: string
  selectedTools: string[]
  userTurns: string[]
  systemPromptFile: string
  systemPromptChoices: { id: string; label: string }[]
  trajA: Trajectory | null
  trajB: Trajectory | null
  rlhfRubrics: QcRlhfRubrics
  rlhfOverallScale: number
  idealByTurn: IdealTurnDraft[]
  activeTurnIndex: number
  onActiveTurnSelect: (index: number) => void
  verifiersByTurn: VerifierTurnDraft[]
  lastAgentRun: {
    model?: string
    system_prompt_file?: string
    system_prompt_text?: string
    agent_log_file?: string | null
  } | null
  lastVerifierSystemPrompt: { file: string; text: string } | null
  qcReview: QcReviewState
  onQcChange: (patch: Partial<QcReviewState>) => void
  onSubmitFullTask: () => void
  submitLoading: boolean
  goldenSavedTo: string | null
  submitError: string | null
  lastPayload: string | null
  /** SQLite replay / QC sync issues */
  dbSyncWarning?: string | null
  /** Bump after replay so snapshot + explorer refetch */
  dbSnapshotRefreshKey?: number
}

export function QcWorkspace({
  metadataRows,
  taskMetadata,
  databaseId,
  selectedTools,
  userTurns,
  systemPromptFile,
  systemPromptChoices,
  trajA,
  trajB,
  rlhfRubrics,
  rlhfOverallScale,
  idealByTurn,
  activeTurnIndex,
  onActiveTurnSelect,
  verifiersByTurn,
  lastAgentRun,
  lastVerifierSystemPrompt,
  qcReview,
  onQcChange,
  onSubmitFullTask,
  submitLoading,
  goldenSavedTo,
  submitError,
  lastPayload,
  dbSyncWarning,
  dbSnapshotRefreshKey = 0,
}: QcWorkspaceProps) {
  const hasTrajectories = trajA && trajB
  const activeIdeal = idealByTurn[activeTurnIndex] ?? emptyIdealTurn()
  const activeVerifier = verifiersByTurn[activeTurnIndex] ?? emptyVerifierTurn()
  const activeTurnA = trajA?.turns[activeTurnIndex] ?? null
  const activeTurnB = trajB?.turns[activeTurnIndex] ?? null
  const activeUserTurn = userTurns[activeTurnIndex] ?? ''
  const dbLabel =
    DATABASES.find((d) => d.id === databaseId)?.label ?? databaseId
  const sysLabel =
    systemPromptChoices.find((p) => p.id === systemPromptFile)?.label ??
    systemPromptFile

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        <strong className="font-semibold">QC mode</strong> — view only. You
        cannot edit annotator inputs. Database access is read-only (SELECT
        queries only). Use the form at the bottom to record ratings and submit
        with the golden task JSON.
      </div>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 px-4 py-3 text-xs leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300">
        <strong className="font-medium text-zinc-800 dark:text-zinc-200">
          QC database sync
        </strong>{' '}
        — When you open this tab, the server resets forks <strong>A</strong> and{' '}
        <strong>B</strong> and replays trajectory A/B from the stored step list
        (same source as the UI), then replays the <strong>ideal</strong> fork when
        section 3 has steps. That keeps SQLite aligned with the annotator for both
        agent runs.
      </div>
      {dbSyncWarning ? (
        <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
          <strong className="font-semibold">DB sync warning</strong> —{' '}
          {dbSyncWarning}
        </div>
      ) : null}

      <QcSection
        title="Database snapshot & explorer"
        description="Per-fork SQLite state for this RL session. Queries are validated as read-only on the server."
      >
        <DbSnapshotStrip refreshKey={dbSnapshotRefreshKey} />
        <div className="mt-4">
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Full explorer (same as annotator): browse tables and run SELECT
            statements per fork.
          </p>
          <DbExplorer reloadSignal={dbSnapshotRefreshKey} />
        </div>
      </QcSection>

      <QcSection
        title="1. Metadata (view)"
        description="CSV-derived rows as loaded by the annotator."
      >
        {metadataRows.length > 0 ? (
          <div className="max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/50">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
                <tr>
                  <th className="p-2 font-medium">#</th>
                  <th className="p-2 font-medium">Metadata (JSON)</th>
                </tr>
              </thead>
              <tbody>
                {metadataRows.map((r) => (
                  <tr
                    key={r.rowIndex}
                    className="border-t border-zinc-200 dark:border-zinc-700"
                  >
                    <td className="p-2 align-top text-zinc-500">
                      {r.rowIndex}
                    </td>
                    <td className="p-2 font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No metadata rows loaded.</p>
        )}
      </QcSection>

      <QcSection
        title="2. Prompt, project & trajectories (view)"
        description="Execution settings and paired responses as produced by the annotator."
      >
        <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-900/30">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Task metadata
          </p>
          <TaskMetadataFields value={taskMetadata} onChange={() => {}} readOnly />
        </div>

        <div className="mb-4 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <span className="font-medium text-zinc-500">Execution mode</span>
            <p className="mt-1 text-zinc-800 dark:text-zinc-200">
              Real (GPT + JIRA tools)
            </p>
          </div>
          <div>
            <span className="font-medium text-zinc-500">
              System prompt file
            </span>
            <p className="mt-1 font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
              {sysLabel} — {systemPromptFile}
            </p>
          </div>
          <div>
            <span className="font-medium text-zinc-500">JIRA project</span>
            <p className="mt-1 text-zinc-800 dark:text-zinc-200">
              {dbLabel} ({databaseId})
            </p>
          </div>
          <div>
            <span className="font-medium text-zinc-500">Tools</span>
            <p className="mt-1 text-zinc-800 dark:text-zinc-200">
              {selectedTools.length
                ? selectedTools.join(', ')
                : 'None selected'}
            </p>
          </div>
        </div>
        {lastAgentRun ? (
          <div className="mb-4 rounded-lg border border-zinc-100 bg-zinc-50/80 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
            <p>
              Model{' '}
              <code className="text-[11px]">{lastAgentRun.model ?? '—'}</code>,
              system{' '}
              <code className="text-[11px]">
                {lastAgentRun.system_prompt_file ?? '—'}
              </code>
            </p>
            {lastAgentRun.agent_log_file ? (
              <p className="mt-1">
                Log:{' '}
                <code className="break-all text-[11px]">
                  {lastAgentRun.agent_log_file}
                </code>
              </p>
            ) : null}
          </div>
        ) : null}

        <TurnNavigationBar
          turnCount={userTurns.length}
          activeIndex={activeTurnIndex}
          onSelect={onActiveTurnSelect}
          showAdd={false}
          allowRemove={false}
        />
        <label className="mb-1 mt-3 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Prompt — turn {activeTurnIndex + 1}
        </label>
        <div className="rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800/50">
          <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
            {activeUserTurn || '(empty)'}
          </p>
        </div>

        {!hasTrajectories ? (
          <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900/30">
            No trajectories yet — annotator has not run generate.
          </div>
        ) : (
          <>
            <div className="mt-8">
              <h3 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Trajectories & annotator RLHF rubrics — turn{' '}
                {activeTurnIndex + 1}
              </h3>
              <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {RLHF_COMPARISON_INTRO}
              </p>
              <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                {(['A', 'B'] as const).map((side) => {
                  const t = side === 'A' ? trajA! : trajB!
                  const turn = side === 'A' ? activeTurnA : activeTurnB
                  const r = rlhfRubrics[side]
                  return (
                    <div
                      key={side}
                      className="flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-violet-700 dark:text-violet-400">
                          {t.label}
                        </span>
                        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {turn?.steps.length ?? 0} tool
                          {(turn?.steps.length ?? 0) === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-3 max-h-[28rem] min-h-0 overflow-y-auto rounded-lg border border-zinc-200/80 bg-white/60 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
                        <TrajectoryTurnPanel
                          turn={turn}
                          emptyMessage="No trajectory recorded for this turn."
                        />
                      </div>
                      <QcRlhfReadonlyBlock
                        title="Instruction following"
                        level={r.instructionFollowing}
                        rationale={r.instructionFollowingRationale}
                      />
                      <QcRlhfReadonlyBlock
                        title="Accuracy"
                        level={r.accuracy}
                        rationale={r.accuracyRationale}
                      />
                    </div>
                  )
                })}
              </div>

              <div className="mt-8 rounded-2xl border border-zinc-200 bg-gradient-to-b from-violet-50/80 to-white p-5 dark:border-zinc-700 dark:from-violet-950/30 dark:to-zinc-900/80">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Overall preference (annotator scale 1–7)
                </h4>
                <p className="mt-2 text-center text-sm font-medium text-violet-800 dark:text-violet-300">
                  {rlhfOverallScale} —{' '}
                  {RLHF_OVERALL_SCALE_LABELS[rlhfOverallScale]}
                </p>
              </div>
            </div>
          </>
        )}
      </QcSection>

      <QcSection
        title={`3. Ideal trajectory (view) — turn ${activeTurnIndex + 1}`}
        description="Gold trace for the selected conversation turn."
      >
        {activeIdeal.source ? (
          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
            Turn {activeTurnIndex + 1} based on trajectory{' '}
            <strong>{activeIdeal.source}</strong>
          </p>
        ) : activeIdeal.steps.length > 0 ? (
          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
            Turn {activeTurnIndex + 1} — custom steps
          </p>
        ) : null}
        <RecommendedToolsPanel
          turnIndex={activeTurnIndex}
          userMessage={activeUserTurn}
          selectedTools={selectedTools}
          usedTools={activeIdeal.steps.map((s) => s.tool)}
        />
        {activeIdeal.steps.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No ideal steps for turn {activeTurnIndex + 1}.
          </p>
        ) : (
          <div className="space-y-3">
            {activeIdeal.steps.map((step) => (
              <div
                key={step.id}
                className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/40"
              >
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Step {step.order} ·{' '}
                  <span className="font-mono text-xs">{step.tool}</span>
                </p>
                <p className="mt-2 text-xs font-medium text-zinc-500">Input</p>
                <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-200 bg-white p-2 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950">
                  {step.input}
                </pre>
                <p className="mt-2 text-xs font-medium text-zinc-500">Output</p>
                <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-200 bg-white p-2 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950">
                  {step.output}
                </pre>
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Final response (ideal) — turn {activeTurnIndex + 1}
              </label>
              <textarea
                readOnly
                value={activeIdeal.finalResponse}
                rows={5}
                className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
              />
            </div>
          </div>
        )}
      </QcSection>

      <QcSection
        title={`4. Verifiers (view) — turn ${activeTurnIndex + 1}`}
        description="Per-turn AI snapshot and human ideal rubrics submitted with the task."
      >
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Trace (AI)
            </label>
            <textarea
              readOnly
              value={activeVerifier.traceAi}
              rows={6}
              className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              End-state (AI)
            </label>
            <textarea
              readOnly
              value={activeVerifier.endStateAi}
              rows={6}
              className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
            />
          </div>
        </div>
        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Ideal verifiers (human)
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Trace (ideal)
              </label>
              <textarea
                readOnly
                value={activeVerifier.traceIdeal}
                rows={6}
                className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                End-state (ideal)
              </label>
              <textarea
                readOnly
                value={activeVerifier.endStateIdeal}
                rows={6}
                className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
              />
            </div>
          </div>
        </div>
        {lastVerifierSystemPrompt ? (
          <details className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Verifier generation system prompt (
              {lastVerifierSystemPrompt.file})
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-700 dark:text-zinc-300">
              {lastVerifierSystemPrompt.text}
            </pre>
          </details>
        ) : null}
      </QcSection>

      <QcSection
        title="QC review"
        description="Rate each dimension from 1 (poor) to 5 (excellent). Rationales are included in the golden JSON under qc_review."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <QcRatingDimension
            title="Prompt"
            hint="Clarity, scope, and suitability of the task prompt."
            value={qcReview.promptRating}
            onValue={(n) => onQcChange({ promptRating: n })}
            rationale={qcReview.promptRationale}
            onRationale={(s) => onQcChange({ promptRationale: s })}
          />
          <QcRatingDimension
            title="Response"
            hint="Quality of model trajectories A/B and final answers."
            value={qcReview.responseRating}
            onValue={(n) => onQcChange({ responseRating: n })}
            rationale={qcReview.responseRationale}
            onRationale={(s) => onQcChange({ responseRationale: s })}
          />
          <QcRatingDimension
            title="Ideal trajectory"
            hint="Gold trace steps and ideal final response."
            value={qcReview.idealTrajectoryRating}
            onValue={(n) => onQcChange({ idealTrajectoryRating: n })}
            rationale={qcReview.idealTrajectoryRationale}
            onRationale={(s) => onQcChange({ idealTrajectoryRationale: s })}
          />
          <QcRatingDimension
            title="Verifiers"
            hint="Trace and end-state rubrics (AI + ideal)."
            value={qcReview.verifiersRating}
            onValue={(n) => onQcChange({ verifiersRating: n })}
            rationale={qcReview.verifiersRationale}
            onRationale={(s) => onQcChange({ verifiersRationale: s })}
          />
        </div>
        <div className="mt-4">
          <QcRatingDimension
            title="Overall"
            hint="Holistic quality of the packaged task."
            value={qcReview.overallRating}
            onValue={(n) => onQcChange({ overallRating: n })}
            rationale={qcReview.overallRationale}
            onRationale={(s) => onQcChange({ overallRationale: s })}
          />
        </div>

        <button
          type="button"
          disabled={submitLoading}
          onClick={() => void onSubmitFullTask()}
          className="mt-6 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLoading ? 'Saving…' : 'Submit full task (with QC review)'}
        </button>

        {goldenSavedTo ? (
          <div className="mt-3 space-y-1 text-sm text-emerald-700 dark:text-emerald-400">
            <p>
              Saved to{' '}
              <code className="rounded bg-zinc-200 px-1 text-xs dark:bg-zinc-700">
                {goldenSavedTo}
              </code>
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Episode DB was reset on the server; refresh the explorer if needed.
            </p>
          </div>
        ) : null}
        {submitError ? (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400">
            {submitError}
          </p>
        ) : null}

        {lastPayload ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase text-zinc-500">
              Last submission payload (JSON)
            </p>
            <pre className="max-h-80 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              {lastPayload}
            </pre>
          </div>
        ) : null}
      </QcSection>
    </div>
  )
}
