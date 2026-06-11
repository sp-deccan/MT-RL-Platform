import type { TrajectoryTurn } from '../types'
import { TrajectoryStepCollapsibleList } from './TrajectoryStepCollapsibleList'

export function TrajectoryTurnPanel({
  turn,
  emptyMessage = 'No trajectory for this turn yet — run generate after adding prompts.',
}: {
  turn: TrajectoryTurn | null
  emptyMessage?: string
}) {
  if (!turn) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Tool trace ({turn.steps.length} step
          {turn.steps.length === 1 ? '' : 's'})
        </h4>
        <TrajectoryStepCollapsibleList steps={turn.steps} />
      </div>
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Assistant response
        </h4>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          {turn.assistantMessage || '(no assistant text)'}
        </p>
      </div>
    </div>
  )
}
