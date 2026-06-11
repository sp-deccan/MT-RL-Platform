export type TrajectoryStep = {
  id: string
  order: number
  tool: string
  input: string
  output: string
  /** Conversation turn this tool step belongs to (1-based). */
  turnOrder?: number
  /** Set after user runs a step (dummy execution) */
  ran?: boolean
}

/** One user message → tool trace → assistant reply. */
export type TrajectoryTurn = {
  id: string
  order: number
  userMessage: string
  assistantMessage: string
  steps: TrajectoryStep[]
}

export type Trajectory = {
  id: 'A' | 'B'
  label: string
  /** Multi-turn conversation segments. */
  turns: TrajectoryTurn[]
  /** Last turn assistant text (convenience for RLHF / ideal copy). */
  finalResponse: string
  /** Flattened tool steps across all turns (replay / QC). */
  steps: TrajectoryStep[]
}

export function flattenTrajectorySteps(turns: TrajectoryTurn[]): TrajectoryStep[] {
  const out: TrajectoryStep[] = []
  let order = 0
  for (const turn of turns) {
    for (const step of turn.steps) {
      order += 1
      out.push({ ...step, order, turnOrder: turn.order })
    }
  }
  return out
}

export type MetadataRow = {
  rowIndex: number
  metadata: Record<string, unknown>
  rawCells: Record<string, string>
}
