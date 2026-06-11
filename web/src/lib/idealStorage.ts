import type { TrajectoryStep } from '../types'

export const IDEAL_STORAGE_KEY = 'rl-platform-ideal-v1'

export type IdealTurnDraft = {
  source: 'A' | 'B' | null
  steps: TrajectoryStep[]
  finalResponse: string
}

export function emptyIdealTurn(): IdealTurnDraft {
  return { source: null, steps: [], finalResponse: '' }
}

export function createIdealByTurn(count: number): IdealTurnDraft[] {
  const n = Math.max(1, count)
  return Array.from({ length: n }, () => emptyIdealTurn())
}

export function flattenIdealSteps(turns: IdealTurnDraft[]): TrajectoryStep[] {
  const out: TrajectoryStep[] = []
  let order = 0
  for (let ti = 0; ti < turns.length; ti++) {
    for (const s of turns[ti]!.steps) {
      order += 1
      out.push({ ...s, order, turnOrder: ti + 1 })
    }
  }
  return out
}

export type StoredIdealV1 = {
  version: 1
  savedAt: string
  idealSource: 'A' | 'B' | null
  idealSteps: TrajectoryStep[]
  idealFinalResponse: string
}

export type StoredIdealV2 = {
  version: 2
  savedAt: string
  turns: IdealTurnDraft[]
}

export function readStoredIdeal(): StoredIdealV2 | null {
  try {
    const raw = localStorage.getItem(IDEAL_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as StoredIdealV1 | StoredIdealV2
    if (v?.version === 2 && Array.isArray(v.turns)) {
      return v
    }
    if (v?.version === 1 && Array.isArray(v.idealSteps)) {
      return {
        version: 2,
        savedAt: v.savedAt,
        turns: [
          {
            source: v.idealSource,
            steps: v.idealSteps,
            finalResponse: v.idealFinalResponse,
          },
        ],
      }
    }
    return null
  } catch {
    return null
  }
}

export function writeStoredIdeal(
  data: { savedAt: string; turns: IdealTurnDraft[] },
): void {
  const payload: StoredIdealV2 = {
    version: 2,
    savedAt: data.savedAt,
    turns: data.turns,
  }
  localStorage.setItem(IDEAL_STORAGE_KEY, JSON.stringify(payload))
}

export function fingerprintIdealTurn(draft: IdealTurnDraft): string {
  return JSON.stringify({
    s: draft.source,
    steps: draft.steps.map(
      ({ id, order, tool, input: inp, output, ran, turnOrder }) => ({
        id,
        order,
        tool,
        input: inp,
        output,
        ran: !!ran,
        turnOrder,
      }),
    ),
    final: draft.finalResponse,
  })
}

export function fingerprintIdealByTurn(turns: IdealTurnDraft[]): string {
  return JSON.stringify(turns.map((t) => JSON.parse(fingerprintIdealTurn(t))))
}

/** @deprecated Use fingerprintIdealTurn / fingerprintIdealByTurn */
export function fingerprintIdeal(input: {
  idealSource: 'A' | 'B' | null
  idealSteps: TrajectoryStep[]
  idealFinalResponse: string
}): string {
  return fingerprintIdealTurn({
    source: input.idealSource,
    steps: input.idealSteps,
    finalResponse: input.idealFinalResponse,
  })
}
