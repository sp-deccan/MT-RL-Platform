import type { Trajectory, TrajectoryTurn } from '../types'
import { flattenTrajectorySteps } from '../types'

/** Normalize API / legacy trajectories that may omit ``turns``. */
export function normalizeTrajectory(raw: Trajectory): Trajectory {
  if (raw.turns?.length) {
    const steps = raw.steps?.length
      ? raw.steps
      : flattenTrajectorySteps(raw.turns)
    const finalResponse =
      raw.finalResponse?.trim() ||
      raw.turns[raw.turns.length - 1]?.assistantMessage ||
      ''
    return { ...raw, turns: raw.turns, steps, finalResponse }
  }

  const userMessage = '(single-turn task)'
  const turn: TrajectoryTurn = {
    id: `turn-legacy-${raw.id}`,
    order: 1,
    userMessage,
    assistantMessage: raw.finalResponse,
    steps: raw.steps ?? [],
  }
  return {
    ...raw,
    turns: [turn],
    steps: raw.steps ?? [],
    finalResponse: raw.finalResponse,
  }
}
