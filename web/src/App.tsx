import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DATABASES,
  AVAILABLE_TOOLS,
  RLHF_COMPARISON_INTRO,
  RLHF_OVERALL_SCALE_LABELS,
} from './constants'
import { parseMetadataCsv } from './lib/csv'
import {
  EXAMPLE_SELECTED_TOOLS,
  EXAMPLE_TRAJECTORY_A,
  EXAMPLE_TRAJECTORY_B,
  EXAMPLE_USER_TURNS,
  EXAMPLE_IDEAL_BY_TURN,
  EXAMPLE_VERIFIERS_BY_TURN,
} from './lib/exampleContent'
import { normalizeTrajectory } from './lib/trajectoryUtils'
import { generateVerifiersFromIdeal } from './lib/generateVerifiers'
import {
  createVerifiersByTurn,
  emptyVerifierTurn,
  type VerifierTurnDraft,
} from './lib/verifierTurns'
import {
  createIdealByTurn,
  emptyIdealTurn,
  flattenIdealSteps,
  fingerprintIdealByTurn,
  readStoredIdeal,
  writeStoredIdeal,
  type IdealTurnDraft,
} from './lib/idealStorage'
import { AutoResizeTextarea } from './components/AutoResizeTextarea'
import { RecommendedToolsPanel } from './components/RecommendedToolsPanel'
import { TaskMetadataFields } from './components/TaskMetadataFields'
import { DbExplorer } from './components/DbExplorer'
import { QcWorkspace } from './components/QcWorkspace'
import { TrajectoryTurnPanel } from './components/TrajectoryTurnPanel'
import { TurnNavigationBar } from './components/TurnNavigationBar'
import {
  fetchSystemPrompts,
  generateTaskPrompt,
  runRealAgent,
  invokeIdealTool,
  generateVerifiersAi,
  syncSessionForQcView,
  saveGoldenTask,
} from './lib/api'
import { getRlSessionId, rotateRlSessionId } from './lib/rlSession'
import {
  EXAMPLE_TASK_METADATA,
  type TaskMetadata,
} from './lib/taskMetadata'
import type { MetadataRow, Trajectory, TrajectoryStep } from './types'
import {
  createEmptyQcReview,
  qcReviewToPayload,
  type QcReviewState,
} from './types/qc'

function metadataSummaryForApi(rows: MetadataRow[]): string | null {
  if (rows.length === 0) return null
  const slim = rows.slice(0, 80).map((r) => ({
    row: r.rowIndex,
    metadata: r.metadata,
  }))
  return JSON.stringify(slim).slice(0, 12000)
}

function cloneStepsForIdeal(
  steps: TrajectoryStep[],
  prefix: string,
): TrajectoryStep[] {
  return reindexSteps(
    steps.map((s, i) => ({
      ...s,
      id: `ideal-${prefix}-${i}-${crypto.randomUUID().slice(0, 8)}`,
      ran: false,
    })),
  )
}

function reindexSteps(steps: TrajectoryStep[]): TrajectoryStep[] {
  return steps.map((s, i) => ({ ...s, order: i + 1 }))
}

function createBlankStep(databaseId: string): TrajectoryStep {
  return {
    id: `ideal-${crypto.randomUUID().slice(0, 12)}`,
    order: 1,
    tool: AVAILABLE_TOOLS[0]!,
    input: JSON.stringify({ project_key: databaseId }, null, 2),
    output: '',
    ran: false,
  }
}

type RlhfIssueLevel = 'no_issue' | 'minor_issue' | 'major_issue'

type RlhfPerResponseRubric = {
  instructionFollowing: RlhfIssueLevel | null
  instructionFollowingRationale: string
  accuracy: RlhfIssueLevel | null
  accuracyRationale: string
}

function emptyRlhfRubric(): RlhfPerResponseRubric {
  return {
    instructionFollowing: null,
    instructionFollowingRationale: '',
    accuracy: null,
    accuracyRationale: '',
  }
}

const RLHF_ISSUE_OPTIONS: { id: RlhfIssueLevel; label: string }[] = [
  { id: 'no_issue', label: 'No issue' },
  { id: 'minor_issue', label: 'Minor issue' },
  { id: 'major_issue', label: 'Major issue' },
]

function RlhfCriterionBlock({
  title,
  value,
  onSelect,
  rationale,
  onRationaleChange,
  rationalePlaceholder,
}: {
  title: string
  value: RlhfIssueLevel | null
  onSelect: (v: RlhfIssueLevel) => void
  rationale: string
  onRationaleChange: (s: string) => void
  rationalePlaceholder: string
}) {
  return (
    <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {RLHF_ISSUE_OPTIONS.map((o) => {
          const on = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              className={
                on
                  ? 'rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white'
                  : 'rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:border-violet-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        Rationale
      </label>
      <textarea
        value={rationale}
        onChange={(e) => onRationaleChange(e.target.value)}
        rows={3}
        placeholder={rationalePlaceholder}
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs leading-relaxed text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
      />
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
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

export default function App() {
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([])
  const [csvError, setCsvError] = useState<string | null>(null)
  const [databaseId, setDatabaseId] = useState<string>(DATABASES[0]!.id)
  const [selectedTools, setSelectedTools] = useState<string[]>([
    ...EXAMPLE_SELECTED_TOOLS,
  ])
  const [taskMetadata, setTaskMetadata] = useState<TaskMetadata>(() => ({
    ...EXAMPLE_TASK_METADATA,
  }))
  const [userTurns, setUserTurns] = useState<string[]>([...EXAMPLE_USER_TURNS])
  const [activeTurnIndex, setActiveTurnIndex] = useState(0)
  const [trajA, setTrajA] = useState<Trajectory | null>(EXAMPLE_TRAJECTORY_A)
  const [trajB, setTrajB] = useState<Trajectory | null>(EXAMPLE_TRAJECTORY_B)
  const [showingExampleData, setShowingExampleData] = useState(true)
  const [idealByTurn, setIdealByTurn] = useState<IdealTurnDraft[]>(() => [
    ...EXAMPLE_IDEAL_BY_TURN,
  ])
  const [verifiersByTurn, setVerifiersByTurn] = useState<VerifierTurnDraft[]>(
    () => [...EXAMPLE_VERIFIERS_BY_TURN],
  )
  const [lastPayload, setLastPayload] = useState<string | null>(null)
  const [idealInvokeLoadingIdx, setIdealInvokeLoadingIdx] = useState<
    number | null
  >(null)
  const [verifierGenLoading, setVerifierGenLoading] = useState(false)
  const [verifierGenError, setVerifierGenError] = useState<string | null>(null)
  const [verifierLogFile, setVerifierLogFile] = useState<string | null>(null)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [goldenSavedTo, setGoldenSavedTo] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<'annotator' | 'qc'>(
    'annotator',
  )
  const [qcReview, setQcReview] = useState<QcReviewState>(() =>
    createEmptyQcReview(),
  )
  /** QC: session sync (replay) failed or had tool errors. */
  const [qcSessionSyncError, setQcSessionSyncError] = useState<string | null>(null)
  /** Bumps after ``/api/session/sync-for-qc-view`` so snapshot + explorer refetch. */
  const [qcDbSnapshotNonce, setQcDbSnapshotNonce] = useState(0)

  const [idealSavedAt, setIdealSavedAt] = useState<string | null>(null)
  const [idealSavedFingerprint, setIdealSavedFingerprint] = useState<
    string | null
  >(null)
  const [browserDraftExists, setBrowserDraftExists] = useState(false)

  const [rlhfRubrics, setRlhfRubrics] = useState<{
    A: RlhfPerResponseRubric
    B: RlhfPerResponseRubric
  }>({ A: emptyRlhfRubric(), B: emptyRlhfRubric() })
  /** 1 = strongly prefer A, 7 = strongly prefer B (see RLHF_OVERALL_SCALE_LABELS). */
  const [rlhfOverallScale, setRlhfOverallScale] = useState(4)

  const [systemPromptFile, setSystemPromptFile] = useState('default.md')
  const [systemPromptChoices, setSystemPromptChoices] = useState<
    { id: string; label: string }[]
  >([{ id: 'default.md', label: 'Default' }])
  const [promptGenerating, setPromptGenerating] = useState(false)
  const [promptGenerateError, setPromptGenerateError] = useState<string | null>(
    null,
  )
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [lastAgentRun, setLastAgentRun] = useState<{
    model?: string
    system_prompt_file?: string
    system_prompt_text?: string
    agent_log_file?: string | null
  } | null>(null)
  const [lastVerifierSystemPrompt, setLastVerifierSystemPrompt] = useState<{
    file: string
    text: string
  } | null>(null)

  const updateQcReview = useCallback((patch: Partial<QcReviewState>) => {
    setQcReview((prev) => ({ ...prev, ...patch }))
  }, [])

  const toggleTool = (t: string) => {
    setSelectedTools((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }

  const onCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCsvError(null)
    try {
      const rows = await parseMetadataCsv(f)
      setMetadataRows(rows)
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV')
    }
    e.target.value = ''
  }

  useEffect(() => {
    setBrowserDraftExists(readStoredIdeal() !== null)
  }, [])

  useEffect(() => {
    fetchSystemPrompts()
      .then((list) => {
        if (list.length) setSystemPromptChoices(list)
      })
      .catch(() => {
        /* API offline — keep local default */
      })
  }, [])

  useEffect(() => {
    if (workspaceTab !== 'qc') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await syncSessionForQcView({
          steps_a: trajA?.steps ?? [],
          steps_b: trajB?.steps ?? [],
          steps_ideal: flattenIdealSteps(idealByTurn),
        })
        if (cancelled) return
        const msgs: string[] = []
        if (res.errors_a?.length) {
          msgs.push(`Fork A: ${res.errors_a.length} replay error(s)`)
        }
        if (res.errors_b?.length) {
          msgs.push(`Fork B: ${res.errors_b.length} replay error(s)`)
        }
        if (res.errors_ideal?.length) {
          msgs.push(`Ideal: ${res.errors_ideal.length} replay error(s)`)
        }
        setQcSessionSyncError(msgs.length ? msgs.join('; ') : null)
        setQcDbSnapshotNonce((n) => n + 1)
      } catch (e) {
        if (cancelled) return
        setQcSessionSyncError(
          e instanceof Error
            ? e.message
            : 'QC: could not sync SQLite with trajectories (is the backend running?)',
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceTab, trajA, trajB, idealByTurn])

  const runGeneratePrompt = useCallback(async () => {
    setPromptGenerateError(null)
    setPromptGenerating(true)
    try {
      const res = await generateTaskPrompt({
        project_key: databaseId,
        selected_tools: selectedTools,
        metadata_summary: metadataSummaryForApi(metadataRows),
      })
      setUserTurns((prev) => {
        const next = [...prev]
        next[activeTurnIndex] = res.prompt
        return next
      })
    } catch (e) {
      setPromptGenerateError(
        e instanceof Error ? e.message : 'Failed to generate prompt',
      )
    } finally {
      setPromptGenerating(false)
    }
  }, [databaseId, selectedTools, metadataRows, activeTurnIndex])

  const runGenerate = useCallback(async () => {
    setAgentError(null)
    setLastAgentRun(null)
    setLastVerifierSystemPrompt(null)
    setVerifiersByTurn(createVerifiersByTurn(userTurns.length))
    setIdealByTurn(createIdealByTurn(userTurns.length))
    setIdealSavedAt(null)
    setIdealSavedFingerprint(null)
    setRlhfRubrics({ A: emptyRlhfRubric(), B: emptyRlhfRubric() })
    setRlhfOverallScale(4)
    setQcReview(createEmptyQcReview())

    setAgentLoading(true)
    try {
      const turns = userTurns.map((t) => t.trim()).filter(Boolean)
      const res = await runRealAgent({
        user_turns: turns,
        project_key: databaseId,
        selected_tools: selectedTools,
        system_prompt_file: systemPromptFile,
        metadata_summary: metadataSummaryForApi(metadataRows),
      })
      setTrajA(normalizeTrajectory(res.A))
      setTrajB(normalizeTrajectory(res.B))
      setShowingExampleData(false)
      setLastAgentRun({
        model: res.model,
        system_prompt_file: res.system_prompt_file,
        system_prompt_text: res.system_prompt_text,
        agent_log_file: res.agent_log_file ?? null,
      })
      setQcSessionSyncError(null)
      try {
        const syn = await syncSessionForQcView({
          steps_a: res.A.steps,
          steps_b: res.B.steps,
          steps_ideal: [],
        })
        const msgs: string[] = []
        if (syn.errors_a?.length) {
          msgs.push(`Fork A: ${syn.errors_a.length} replay error(s)`)
        }
        if (syn.errors_b?.length) {
          msgs.push(`Fork B: ${syn.errors_b.length} replay error(s)`)
        }
        if (syn.errors_ideal?.length) {
          msgs.push(`Ideal: ${syn.errors_ideal.length} replay error(s)`)
        }
        if (msgs.length) setQcSessionSyncError(msgs.join('; '))
        setQcDbSnapshotNonce((n) => n + 1)
      } catch (err) {
        setQcSessionSyncError(
          err instanceof Error
            ? err.message
            : 'Could not align SQLite with trajectories after agent run.',
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAgentError(msg)
      setTrajA(null)
      setTrajB(null)
    } finally {
      setAgentLoading(false)
    }
  }, [userTurns, databaseId, selectedTools, systemPromptFile, metadataRows])

  useEffect(() => {
    setIdealByTurn((prev) => {
      if (prev.length === userTurns.length) return prev
      if (prev.length < userTurns.length) {
        return [
          ...prev,
          ...Array.from(
            { length: userTurns.length - prev.length },
            emptyIdealTurn,
          ),
        ]
      }
      return prev.slice(0, userTurns.length)
    })
    setVerifiersByTurn((prev) => {
      if (prev.length === userTurns.length) return prev
      if (prev.length < userTurns.length) {
        return [
          ...prev,
          ...Array.from(
            { length: userTurns.length - prev.length },
            emptyVerifierTurn,
          ),
        ]
      }
      return prev.slice(0, userTurns.length)
    })
  }, [userTurns.length])

  const activeIdeal = useMemo(
    () => idealByTurn[activeTurnIndex] ?? emptyIdealTurn(),
    [idealByTurn, activeTurnIndex],
  )

  const allIdealSteps = useMemo(
    () => flattenIdealSteps(idealByTurn),
    [idealByTurn],
  )

  const updateActiveIdeal = useCallback(
    (patch: Partial<IdealTurnDraft>) => {
      setIdealByTurn((prev) =>
        prev.map((draft, i) =>
          i === activeTurnIndex ? { ...draft, ...patch } : draft,
        ),
      )
      setIdealSavedFingerprint(null)
      setIdealSavedAt(null)
    },
    [activeTurnIndex],
  )

  const updateActiveIdealSteps = useCallback(
    (updater: (steps: TrajectoryStep[]) => TrajectoryStep[]) => {
      setIdealByTurn((prev) =>
        prev.map((draft, i) =>
          i === activeTurnIndex
            ? { ...draft, steps: updater(draft.steps) }
            : draft,
        ),
      )
      setIdealSavedFingerprint(null)
      setIdealSavedAt(null)
    },
    [activeTurnIndex],
  )

  const loadIdealFrom = (which: 'A' | 'B') => {
    const src = which === 'A' ? trajA : trajB
    const turn = src?.turns[activeTurnIndex]
    if (!turn) return
    updateActiveIdeal({
      source: which,
      steps: cloneStepsForIdeal(turn.steps, which),
      finalResponse: turn.assistantMessage,
    })
  }

  const removeIdealStep = (index: number) => {
    updateActiveIdealSteps((prev) =>
      reindexSteps(prev.filter((_, i) => i !== index)),
    )
  }

  const addIdealStep = (afterIndex?: number) => {
    const blank = createBlankStep(databaseId)
    updateActiveIdealSteps((prev) => {
      let next: TrajectoryStep[]
      if (afterIndex === undefined) {
        next = [...prev, blank]
      } else {
        next = [
          ...prev.slice(0, afterIndex + 1),
          blank,
          ...prev.slice(afterIndex + 1),
        ]
      }
      return reindexSteps(next)
    })
  }

  const startBlankIdeal = () => {
    updateActiveIdeal({
      source: null,
      steps: reindexSteps([createBlankStep(databaseId)]),
      finalResponse: '',
    })
  }

  const currentIdealFingerprint = useMemo(
    () => fingerprintIdealByTurn(idealByTurn),
    [idealByTurn],
  )

  const idealIsDirty = useMemo(() => {
    if (idealSavedFingerprint === null) {
      return idealByTurn.some(
        (t) => t.steps.length > 0 || t.finalResponse.trim().length > 0,
      )
    }
    return currentIdealFingerprint !== idealSavedFingerprint
  }, [idealSavedFingerprint, currentIdealFingerprint, idealByTurn])

  const saveIdealToBrowser = () => {
    const savedAt = new Date().toISOString()
    writeStoredIdeal({
      savedAt,
      turns: idealByTurn,
    })
    setIdealSavedAt(savedAt)
    setIdealSavedFingerprint(currentIdealFingerprint)
    setBrowserDraftExists(true)
  }

  const restoreIdealFromBrowser = () => {
    const s = readStoredIdeal()
    if (!s) return
    setIdealByTurn(
      s.turns.length
        ? s.turns
        : createIdealByTurn(userTurns.length),
    )
    setIdealSavedAt(s.savedAt)
    setIdealSavedFingerprint(fingerprintIdealByTurn(s.turns))
  }

  const downloadIdealJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 2,
            savedAt: new Date().toISOString(),
            turns: idealByTurn,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ideal-trajectory.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importIdealFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '')
        const data = JSON.parse(raw) as {
          version?: number
          turns?: IdealTurnDraft[]
          idealSteps?: TrajectoryStep[]
          idealFinalResponse?: string
          idealSource?: 'A' | 'B' | null
        }
        if (data.version === 2 && Array.isArray(data.turns)) {
          setIdealByTurn(data.turns)
        } else if (Array.isArray(data.idealSteps)) {
          const next = createIdealByTurn(userTurns.length)
          next[0] = {
            source: data.idealSource ?? null,
            steps: reindexSteps(data.idealSteps),
            finalResponse:
              typeof data.idealFinalResponse === 'string'
                ? data.idealFinalResponse
                : '',
          }
          setIdealByTurn(next)
        } else {
          return
        }
        setIdealSavedFingerprint(null)
        setIdealSavedAt(null)
      } catch {
        /* ignore invalid file */
      }
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  const updateIdealStep = (
    index: number,
    patch: Partial<TrajectoryStep>,
  ) => {
    updateActiveIdealSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    )
  }

  const runIdealStepExecute = async (index: number) => {
    const step = activeIdeal.steps[index]
    if (!step) return
    setIdealInvokeLoadingIdx(index)
    try {
      let args: Record<string, unknown> = {}
      const raw = step.input.trim()
      if (raw) {
        try {
          const p = JSON.parse(raw) as unknown
          if (
            p !== null &&
            typeof p === 'object' &&
            !Array.isArray(p)
          ) {
            args = p as Record<string, unknown>
          } else {
            throw new Error(
              'Arguments must be a JSON object, e.g. {"issue_key": "RL-1"}',
            )
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          updateIdealStep(index, {
            output: `[Invalid JSON arguments]\n${msg}\n\nFix: use a JSON object whose keys match the tool schema (see backend /api/tools/jira or tool descriptions).`,
            ran: false,
          })
          return
        }
      }
      const res = await invokeIdealTool({
        tool: step.tool.trim(),
        arguments: args,
      })
      if (res.ok && res.output !== undefined) {
        updateIdealStep(index, { output: res.output, ran: true })
      } else {
        const err = res.error || 'Tool call failed'
        const sug = res.suggestion?.trim() || ''
        updateIdealStep(index, {
          output: `Execution failed\n\n${err}${sug ? `\n\n---\nSuggestion\n\n${sug}` : ''}`,
          ran: false,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      updateIdealStep(index, {
        output: `Could not reach API or server error\n\n${msg}\n\nStart the backend (uvicorn) and try again.`,
        ran: false,
      })
    } finally {
      setIdealInvokeLoadingIdx(null)
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  const submitFullTask = async () => {
    const payload = {
      metadataRows,
      taskMetadata,
      databaseId,
      selectedTools,
      prompt: promptText,
      userTurns: userTurns.map((t) => t.trim()).filter(Boolean),
      execution_mode: 'real' as const,
      system_prompt_file: systemPromptFile,
      system_prompt_text: lastAgentRun?.system_prompt_text ?? null,
      trajectory_system_prompt: lastAgentRun?.system_prompt_text
        ? {
            file: lastAgentRun.system_prompt_file ?? systemPromptFile,
            text: lastAgentRun.system_prompt_text,
          }
        : null,
      agent: lastAgentRun,
      trajectories: trajA && trajB ? { A: trajA, B: trajB } : null,
      ideal: {
        turns: idealByTurn.map((draft, i) => ({
          turnOrder: i + 1,
          source: draft.source,
          steps: draft.steps,
          finalResponse: draft.finalResponse,
        })),
        source: activeIdeal.source,
        steps: allIdealSteps,
        finalResponse:
          idealByTurn[idealByTurn.length - 1]?.finalResponse ?? '',
      },
      verifiers: {
        turns: verifiersByTurn.map((v, i) => ({
          turnOrder: i + 1,
          ai: { trace: v.traceAi, endState: v.endStateAi },
          ideal: { trace: v.traceIdeal, endState: v.endStateIdeal },
        })),
        ai: {
          trace: verifiersByTurn
            .map((v) => v.traceAi.trim())
            .filter(Boolean)
            .join('\n\n---\n\n'),
          endState: verifiersByTurn
            .map((v) => v.endStateAi.trim())
            .filter(Boolean)
            .join('\n\n---\n\n'),
        },
        ideal: {
          trace: verifiersByTurn
            .map((v) => v.traceIdeal.trim())
            .filter(Boolean)
            .join('\n\n---\n\n'),
          endState: verifiersByTurn
            .map((v) => v.endStateIdeal.trim())
            .filter(Boolean)
            .join('\n\n---\n\n'),
        },
        generation_system_prompt: lastVerifierSystemPrompt,
      },
      rlhf: {
        perResponse: {
          A: {
            instructionFollowing: rlhfRubrics.A.instructionFollowing,
            instructionFollowingRationale:
              rlhfRubrics.A.instructionFollowingRationale,
            accuracy: rlhfRubrics.A.accuracy,
            accuracyRationale: rlhfRubrics.A.accuracyRationale,
          },
          B: {
            instructionFollowing: rlhfRubrics.B.instructionFollowing,
            instructionFollowingRationale:
              rlhfRubrics.B.instructionFollowingRationale,
            accuracy: rlhfRubrics.B.accuracy,
            accuracyRationale: rlhfRubrics.B.accuracyRationale,
          },
        },
        overallComparisonScale1To7: rlhfOverallScale,
        overallScaleLabels: RLHF_OVERALL_SCALE_LABELS,
      },
      rl_session_id: getRlSessionId(),
      qc_review: qcReviewToPayload(qcReview),
      submittedAt: new Date().toISOString(),
    }
    setSubmitLoading(true)
    setSubmitError(null)
    setGoldenSavedTo(null)
    try {
      const { saved_to } = await saveGoldenTask(
        payload as Record<string, unknown>,
      )
      setGoldenSavedTo(saved_to)
      setLastPayload(JSON.stringify(payload, null, 2))
      setQcReview(createEmptyQcReview())
      rotateRlSessionId()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSubmitError(msg)
    } finally {
      setSubmitLoading(false)
    }
  }

  const hasTrajectories = trajA && trajB

  const promptText = useMemo(
    () => userTurns.map((t) => t.trim()).filter(Boolean).join('\n\n'),
    [userTurns],
  )

  const updateUserTurn = useCallback((index: number, value: string) => {
    setUserTurns((prev) =>
      prev.map((turn, i) => (i === index ? value : turn)),
    )
  }, [])

  const addUserTurn = useCallback(() => {
    setUserTurns((prev) => {
      setActiveTurnIndex(prev.length)
      return [...prev, '']
    })
  }, [])

  const removeUserTurn = useCallback((index: number) => {
    setUserTurns((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, i) => i !== index)
      setActiveTurnIndex((current) => {
        if (current > index) return current - 1
        if (current >= next.length) return Math.max(0, next.length - 1)
        return current
      })
      return next
    })
  }, [])

  const activeTurnA = useMemo(
    () => trajA?.turns[activeTurnIndex] ?? null,
    [trajA, activeTurnIndex],
  )
  const activeTurnB = useMemo(
    () => trajB?.turns[activeTurnIndex] ?? null,
    [trajB, activeTurnIndex],
  )
  const activeUserTurn = userTurns[activeTurnIndex] ?? ''

  const activeVerifier = useMemo(
    () => verifiersByTurn[activeTurnIndex] ?? emptyVerifierTurn(),
    [verifiersByTurn, activeTurnIndex],
  )

  const updateActiveVerifier = useCallback(
    (patch: Partial<VerifierTurnDraft>) => {
      setVerifiersByTurn((prev) =>
        prev.map((draft, i) =>
          i === activeTurnIndex ? { ...draft, ...patch } : draft,
        ),
      )
    },
    [activeTurnIndex],
  )

  const canGenerateVerifiers = useMemo(() => {
    return (
      activeIdeal.steps.length > 0 ||
      activeIdeal.finalResponse.trim().length > 0
    )
  }, [activeIdeal])

  const runGenerateVerifiersTemplate = useCallback(() => {
    setVerifierGenError(null)
    setVerifierLogFile(null)
    setLastVerifierSystemPrompt(null)
    const { trace, endState } = generateVerifiersFromIdeal({
      idealFinalResponse: activeIdeal.finalResponse,
      idealSteps: activeIdeal.steps,
      databaseId,
      prompt: activeUserTurn,
      turnOrder: activeTurnIndex + 1,
    })
    updateActiveVerifier({
      traceAi: trace,
      endStateAi: endState,
      traceIdeal: trace,
      endStateIdeal: endState,
    })
  }, [
    activeIdeal,
    databaseId,
    activeUserTurn,
    activeTurnIndex,
    updateActiveVerifier,
  ])

  const runGenerateVerifiersAi = useCallback(async () => {
    setVerifierGenError(null)
    setVerifierLogFile(null)
    setVerifierGenLoading(true)
    try {
      const res = await generateVerifiersAi({
        project_key: databaseId,
        user_prompt: activeUserTurn,
        ideal_steps: activeIdeal.steps.map((s) => ({
          order: s.order,
          tool: s.tool,
          input: s.input,
          output: s.output,
        })),
        ideal_final_response: activeIdeal.finalResponse,
      })
      updateActiveVerifier({
        traceAi: res.trace_verifier,
        endStateAi: res.end_state_verifier,
        traceIdeal: res.trace_verifier,
        endStateIdeal: res.end_state_verifier,
      })
      setVerifierLogFile(res.verifier_log_file ?? null)
      if (res.verifier_system_prompt_text && res.verifier_system_prompt_file) {
        setLastVerifierSystemPrompt({
          file: res.verifier_system_prompt_file,
          text: res.verifier_system_prompt_text,
        })
      } else {
        setLastVerifierSystemPrompt(null)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setVerifierGenError(msg)
    } finally {
      setVerifierGenLoading(false)
    }
  }, [databaseId, activeUserTurn, activeIdeal, updateActiveVerifier])

  const copyAiVerifiersToIdeal = useCallback(() => {
    updateActiveVerifier({
      traceIdeal: activeVerifier.traceAi,
      endStateIdeal: activeVerifier.endStateAi,
    })
  }, [activeVerifier, updateActiveVerifier])

  const toolListHelp = useMemo(
    () => AVAILABLE_TOOLS.join(', '),
    [],
  )

  return (
    <div className="min-h-svh bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900 dark:from-zinc-950 dark:to-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200/80 bg-white/90 px-6 py-6 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            RL trajectory lab
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Upload CSV with JSON metadata, pair prompts with a database and
            tools, compare two agent trajectories, refine an ideal trace step by
            step, then attach verifiers and submit the full task.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex gap-2 rounded-xl border border-zinc-200 bg-white/90 p-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
          <button
            type="button"
            onClick={() => setWorkspaceTab('annotator')}
            className={
              workspaceTab === 'annotator'
                ? 'flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-violet-600'
                : 'flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }
          >
            Annotator
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('qc')}
            className={
              workspaceTab === 'qc'
                ? 'flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-violet-600'
                : 'flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }
          >
            QC
          </button>
        </div>

        {workspaceTab === 'annotator' ? (
          <>
        <Section
          title="1. CSV & metadata"
          description='Upload a CSV. Use a column named "metadata" with JSON per row, or plain columns merged into metadata.'
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-violet-500">
              Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onCsv}
              />
            </label>
            {metadataRows.length > 0 ? (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {metadataRows.length} row(s) loaded
              </span>
            ) : null}
          </div>
          {csvError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {csvError}
            </p>
          ) : null}

          {metadataRows.length > 0 ? (
            <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/50">
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
            <p className="mt-3 text-sm text-zinc-500">
              No file loaded yet. Example row:{' '}
              <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">
                metadata
              </code>{' '}
              column with{' '}
              <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">
                {`{"task_id":"t1"}`}
              </code>
            </p>
          )}
        </Section>

        <div className="mt-6">
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            DB explorer uses three SQLite files per RL session (response A,
            response B, ideal) under{' '}
            <code className="text-[11px]">data/sessions/</code>. They reset after
            golden submit; the UI then picks a new session id.
          </p>
          <DbExplorer reloadSignal={qcDbSnapshotNonce} />
        </div>

        <Section
          title="2. Prompt, project & tools"
          description="Runs LangChain + OpenAI GPT with ~10 JIRA tools against a SQLite DB. Configure the model and API key in config.yaml (see README)."
        >
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Execution mode
              </p>
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Real (GPT + JIRA tools)
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                Proxies to{' '}
                <code className="rounded bg-zinc-200 px-1 text-[11px] dark:bg-zinc-700">
                  /api
                </code>{' '}
                — start the Python backend on port 8000.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                System prompt file
              </label>
              <select
                value={systemPromptFile}
                onChange={(e) => setSystemPromptFile(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              >
                {systemPromptChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.id}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                Files in <code className="text-[11px]">prompts/system/</code>.
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-900/30">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Task metadata
            </p>
            <TaskMetadataFields
              value={taskMetadata}
              onChange={(patch) =>
                setTaskMetadata((prev) => ({ ...prev, ...patch }))
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                JIRA project (context)
              </label>
              <select
                value={databaseId}
                onChange={(e) => setDatabaseId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              >
                {DATABASES.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Available tools (multi-select)
              </p>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_TOOLS.map((t) => {
                  const on = selectedTools.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTool(t)}
                      className={
                        on
                          ? 'rounded-full bg-violet-600 px-3 py-1 text-xs font-medium text-white'
                          : 'rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:border-violet-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
                      }
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Pool: {toolListHelp}
              </p>
            </div>
          </div>

        </Section>

        <div className="sticky top-0 z-30 -mx-4 border-b border-zinc-200/90 bg-gradient-to-b from-zinc-50/98 to-zinc-50/95 px-4 py-4 shadow-sm backdrop-blur-md dark:border-zinc-700/90 dark:from-zinc-950/98 dark:to-zinc-950/95 sm:-mx-6 sm:px-6">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={promptGenerating || agentLoading}
              onClick={() => void runGeneratePrompt()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {promptGenerating ? 'Generating prompt…' : 'Generate prompt'}
            </button>
            {promptGenerateError ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {promptGenerateError}
              </p>
            ) : null}
          </div>
          <TurnNavigationBar
            turnCount={userTurns.length}
            activeIndex={activeTurnIndex}
            onSelect={setActiveTurnIndex}
            onAdd={addUserTurn}
            onRemove={removeUserTurn}
          />
          <label className="mb-1 mt-3 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Prompt — turn {activeTurnIndex + 1}
          </label>
          <AutoResizeTextarea
            value={activeUserTurn}
            onChange={(e) => updateUserTurn(activeTurnIndex, e.target.value)}
            placeholder={
              activeTurnIndex === 0
                ? 'First user message for the agent…'
                : 'Follow-up user message…'
            }
            className="max-h-[30vh] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed dark:border-zinc-600 dark:bg-zinc-900"
          />
        </div>

        <div className="mt-6">
          <button
            type="button"
            disabled={agentLoading}
            onClick={() => void runGenerate()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-600 dark:hover:bg-violet-500"
          >
            {agentLoading
              ? 'Running agent…'
              : 'Generate trajectories A & B'}
          </button>
          {agentError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {agentError}
            </p>
          ) : null}
          {lastAgentRun ? (
            <div className="mt-2 space-y-1 text-xs text-zinc-500">
              <p>
                Last run: model{' '}
                <code className="text-[11px]">{lastAgentRun.model}</code>,
                system{' '}
                <code className="text-[11px]">
                  {lastAgentRun.system_prompt_file}
                </code>
              </p>
              {lastAgentRun.agent_log_file ? (
                <p>
                  Server log:{' '}
                  <code className="break-all text-[11px]">
                    {lastAgentRun.agent_log_file}
                  </code>
                </p>
              ) : null}
            </div>
          ) : null}

          {!hasTrajectories ? (
            <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900/30">
              Run generate to load trajectory A and B below.
            </div>
          ) : (
            <>
              <div className="mt-8">
                <h3 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Trajectories & comparison (GPT + JIRA tools) — turn{' '}
                  {activeTurnIndex + 1}
                  {showingExampleData ? (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                      Example
                    </span>
                  ) : null}
                </h3>
                <p className="mb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {RLHF_COMPARISON_INTRO} Use the turn tabs above to compare
                  each conversation step.
                </p>
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                  {(['A', 'B'] as const).map((side) => {
                    const t = side === 'A' ? trajA! : trajB!
                    const turn =
                      side === 'A' ? activeTurnA : activeTurnB
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
                          <TrajectoryTurnPanel turn={turn} />
                        </div>
                        <RlhfCriterionBlock
                          title="Instruction following"
                          value={r.instructionFollowing}
                          onSelect={(v) =>
                            setRlhfRubrics((prev) => ({
                              ...prev,
                              [side]: { ...prev[side], instructionFollowing: v },
                            }))
                          }
                          rationale={r.instructionFollowingRationale}
                          onRationaleChange={(s) =>
                            setRlhfRubrics((prev) => ({
                              ...prev,
                              [side]: {
                                ...prev[side],
                                instructionFollowingRationale: s,
                              },
                            }))
                          }
                          rationalePlaceholder="Why this rating (optional details)…"
                        />
                        <RlhfCriterionBlock
                          title="Accuracy"
                          value={r.accuracy}
                          onSelect={(v) =>
                            setRlhfRubrics((prev) => ({
                              ...prev,
                              [side]: { ...prev[side], accuracy: v },
                            }))
                          }
                          rationale={r.accuracyRationale}
                          onRationaleChange={(s) =>
                            setRlhfRubrics((prev) => ({
                              ...prev,
                              [side]: { ...prev[side], accuracyRationale: s },
                            }))
                          }
                          rationalePlaceholder="Why this rating (optional details)…"
                        />
                      </div>
                    )
                  })}
                </div>

                <div className="mt-8 rounded-2xl border border-zinc-200 bg-gradient-to-b from-violet-50/80 to-white p-5 dark:border-zinc-700 dark:from-violet-950/30 dark:to-zinc-900/80">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Overall preference (between A and B)
                  </h4>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Drag the slider: <strong>1</strong> means response{' '}
                    <strong>A</strong> is better overall; <strong>7</strong>{' '}
                    means <strong>B</strong> is better. Middle values capture
                    slight lean or a near tie.
                  </p>
                  <div className="mt-4 px-1">
                    <input
                      type="range"
                      min={1}
                      max={7}
                      step={1}
                      value={rlhfOverallScale}
                      onChange={(e) =>
                        setRlhfOverallScale(Number(e.target.value))
                      }
                      className="h-2 w-full cursor-pointer accent-violet-600"
                    />
                    <div className="mt-2 flex justify-between font-mono text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                      <span>1 · A</span>
                      <span>4</span>
                      <span>B · 7</span>
                    </div>
                    <div className="mt-3 hidden grid-cols-7 gap-1 text-center text-[10px] leading-snug text-zinc-500 sm:grid dark:text-zinc-400">
                      {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
                        <div key={n}>
                          <div className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                            {n}
                          </div>
                          <div className="mt-0.5 hyphens-auto break-words">
                            {RLHF_OVERALL_SCALE_LABELS[n]}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-center text-sm font-medium text-violet-800 dark:text-violet-300">
                      {RLHF_OVERALL_SCALE_LABELS[rlhfOverallScale]}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <Section
          title={`3. Ideal trajectory — turn ${activeTurnIndex + 1}`}
          description="Edits the gold trace for the selected conversation turn (use the turn tabs above). Start from A/B for that turn, add steps, run tools on the backend, then save."
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!activeTurnA}
                onClick={() => loadIdealFrom('A')}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
              >
                Use trajectory A (turn {activeTurnIndex + 1})
              </button>
              <button
                type="button"
                disabled={!activeTurnB}
                onClick={() => loadIdealFrom('B')}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
              >
                Use trajectory B (turn {activeTurnIndex + 1})
              </button>
              <button
                type="button"
                onClick={startBlankIdeal}
                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200"
              >
                Start blank trace
              </button>
              {activeIdeal.source ? (
                <span className="self-center text-sm text-zinc-500">
                  Turn {activeTurnIndex + 1} based on {activeIdeal.source}
                </span>
              ) : activeIdeal.steps.length > 0 ? (
                <span className="self-center text-sm text-zinc-500">
                  Turn {activeTurnIndex + 1} — custom steps
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  idealIsDirty
                    ? 'text-xs font-medium text-amber-700 dark:text-amber-400'
                    : idealSavedAt
                      ? 'text-xs text-emerald-700 dark:text-emerald-400'
                      : 'text-xs text-zinc-500'
                }
              >
                {idealIsDirty
                  ? 'Unsaved changes'
                  : idealSavedAt
                    ? `Saved · ${new Date(idealSavedAt).toLocaleString()}`
                    : activeIdeal.steps.length === 0 &&
                        !activeIdeal.finalResponse.trim()
                      ? ''
                      : 'Not saved yet'}
              </span>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
            <button
              type="button"
              disabled={
                !idealByTurn.some(
                  (t) => t.steps.length > 0 || t.finalResponse.trim(),
                )
              }
              onClick={saveIdealToBrowser}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              Save to browser
            </button>
            <button
              type="button"
              disabled={
                !idealByTurn.some(
                  (t) => t.steps.length > 0 || t.finalResponse.trim(),
                )
              }
              onClick={downloadIdealJson}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-900"
            >
              Download JSON
            </button>
            <label className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-900">
              Import JSON
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={importIdealFromFile}
              />
            </label>
            <button
              type="button"
              disabled={!browserDraftExists}
              onClick={restoreIdealFromBrowser}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
            >
              Restore from browser
            </button>
          </div>

          <RecommendedToolsPanel
            turnIndex={activeTurnIndex}
            userMessage={activeUserTurn}
            selectedTools={selectedTools}
            usedTools={activeIdeal.steps.map((s) => s.tool)}
          />

          {activeIdeal.steps.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-500">
                For turn {activeTurnIndex + 1}: use A or B, start a blank trace,
                or import a saved JSON file.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => addIdealStep(undefined)}
                  className="rounded-lg border border-dashed border-zinc-400 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:border-violet-400 hover:text-violet-700 dark:border-zinc-600 dark:text-zinc-300"
                >
                  + Add step at end
                </button>
              </div>
              {activeIdeal.steps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950/40"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      Step {step.order}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => removeIdealStep(index)}
                        className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                      >
                        Remove step
                      </button>
                      <button
                        type="button"
                        onClick={() => addIdealStep(index)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                      >
                        Add step below
                      </button>
                      <button
                        type="button"
                        disabled={idealInvokeLoadingIdx === index}
                        onClick={() => void runIdealStepExecute(index)}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {idealInvokeLoadingIdx === index
                          ? 'Running…'
                          : 'Run step'}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(step.input)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                      >
                        Copy input
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(step.output)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                      >
                        Copy output
                      </button>
                      {step.ran ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          Ran
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs text-zinc-500">Tool</label>
                      <input
                        value={step.tool}
                        onChange={(e) =>
                          updateIdealStep(index, { tool: e.target.value })
                        }
                        className="mt-0.5 w-full rounded border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-zinc-500">
                        Tool input (JSON or text)
                      </label>
                      <textarea
                        value={step.input}
                        onChange={(e) =>
                          updateIdealStep(index, { input: e.target.value })
                        }
                        rows={4}
                        className="mt-0.5 w-full resize-y rounded border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs leading-relaxed dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-zinc-500">Output</label>
                      <textarea
                        value={step.output}
                        onChange={(e) =>
                          updateIdealStep(index, { output: e.target.value })
                        }
                        rows={3}
                        className="mt-0.5 w-full resize-y rounded border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs leading-relaxed dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Final response (ideal) — turn {activeTurnIndex + 1}
                </label>
                {activeIdeal.source ? (
                  <p className="mb-2 text-xs text-zinc-500">
                    Initialized from trajectory {activeIdeal.source} turn{' '}
                    {activeTurnIndex + 1} — edit freely.
                  </p>
                ) : null}
                <textarea
                  value={activeIdeal.finalResponse}
                  onChange={(e) =>
                    updateActiveIdeal({ finalResponse: e.target.value })
                  }
                  rows={5}
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => copyText(activeIdeal.finalResponse)}
                  className="mt-2 rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-600"
                >
                  Copy final response
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section
          title={`4. Verifiers — turn ${activeTurnIndex + 1}`}
          description="Per-turn trace and end-state rubrics for the selected conversation turn. Generate from section 3 ideal for this turn, edit ideal (human) verifiers, then submit."
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                !canGenerateVerifiers || verifierGenLoading
              }
              onClick={() => void runGenerateVerifiersAi()}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {verifierGenLoading ? 'Generating…' : 'Generate verifiers (AI)'}
            </button>
            <button
              type="button"
              disabled={!canGenerateVerifiers || verifierGenLoading}
              onClick={runGenerateVerifiersTemplate}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
            >
              Offline template
            </button>
            <button
              type="button"
              disabled={
                !activeVerifier.traceAi && !activeVerifier.endStateAi
              }
              onClick={copyAiVerifiersToIdeal}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
            >
              Copy AI → ideal
            </button>
            <span className="text-xs text-zinc-500">
              {canGenerateVerifiers
                ? 'AI generation requires OPENAI_API_KEY / config. Use offline template if the API is unavailable.'
                : `Complete ideal steps or final response for turn ${activeTurnIndex + 1} in section 3 first.`}
            </span>
          </div>
          {verifierGenError ? (
            <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {verifierGenError}
            </p>
          ) : null}
          {verifierLogFile ? (
            <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
              Session log (steps + token usage + cost):{' '}
              <code className="rounded bg-zinc-200 px-1 text-[11px] dark:bg-zinc-700">
                {verifierLogFile}
              </code>
            </p>
          ) : null}

          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              AI-generated verifiers (turn {activeTurnIndex + 1})
            </h3>
            <p className="mb-3 text-xs text-zinc-500">
              Frozen snapshot from the last Generate action (stored on submit as{' '}
              <code className="rounded bg-zinc-200 px-1 text-[11px] dark:bg-zinc-700">
                verifiers.ai
              </code>
              ).
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Trace (AI)
                </label>
                <textarea
                  readOnly
                  value={activeVerifier.traceAi}
                  rows={6}
                  placeholder="Click Generate verifiers to populate…"
                  className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
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
                  placeholder="Click Generate verifiers to populate…"
                  className="w-full cursor-default resize-y rounded-lg border border-zinc-200 bg-zinc-100/80 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-200"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
            <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Ideal verifiers (human-corrected) — turn {activeTurnIndex + 1}
            </h3>
            <p className="mb-3 text-xs text-zinc-500">
              Edit these before submit; stored as{' '}
              <code className="rounded bg-zinc-200 px-1 text-[11px] dark:bg-zinc-700">
                verifiers.ideal
              </code>
              . You can type manually or start from AI via Generate / Copy AI →
              ideal.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Trace (ideal)
                </label>
                <textarea
                  value={activeVerifier.traceIdeal}
                  onChange={(e) =>
                    updateActiveVerifier({ traceIdeal: e.target.value })
                  }
                  rows={6}
                  placeholder="Human-edited trace rubric…"
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  End-state (ideal)
                </label>
                <textarea
                  value={activeVerifier.endStateIdeal}
                  onChange={(e) =>
                    updateActiveVerifier({ endStateIdeal: e.target.value })
                  }
                  rows={6}
                  placeholder="Human-edited end-state rubric…"
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={submitLoading}
            onClick={() => void submitFullTask()}
            className="mt-4 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLoading ? 'Saving…' : 'Submit full task'}
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
                Episode JIRA database was cleared on the server; the next tool
                call uses a fresh seed. Refresh the DB explorer if it is open.
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
        </Section>
          </>
        ) : (
          <QcWorkspace
            metadataRows={metadataRows}
            taskMetadata={taskMetadata}
            databaseId={databaseId}
            selectedTools={selectedTools}
            userTurns={userTurns}
            systemPromptFile={systemPromptFile}
            systemPromptChoices={systemPromptChoices}
            trajA={trajA}
            trajB={trajB}
            rlhfRubrics={rlhfRubrics}
            rlhfOverallScale={rlhfOverallScale}
            idealByTurn={idealByTurn}
            activeTurnIndex={activeTurnIndex}
            onActiveTurnSelect={setActiveTurnIndex}
            verifiersByTurn={verifiersByTurn}
            lastAgentRun={lastAgentRun}
            lastVerifierSystemPrompt={lastVerifierSystemPrompt}
            qcReview={qcReview}
            onQcChange={updateQcReview}
            onSubmitFullTask={submitFullTask}
            submitLoading={submitLoading}
            goldenSavedTo={goldenSavedTo}
            submitError={submitError}
            lastPayload={lastPayload}
            dbSyncWarning={qcSessionSyncError}
            dbSnapshotRefreshKey={qcDbSnapshotNonce}
          />
        )}
      </main>

      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
        GPT + JIRA tool-calling agent against per-fork SQLite.
      </footer>
    </div>
  )
}
