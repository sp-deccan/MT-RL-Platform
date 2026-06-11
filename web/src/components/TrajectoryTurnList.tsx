import type { TrajectoryTurn } from '../types'
import { TrajectoryStepCollapsibleList } from './TrajectoryStepCollapsibleList'

export function TrajectoryTurnList({ turns }: { turns: TrajectoryTurn[] }) {
  if (turns.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No conversation turns in this trajectory.</p>
    )
  }

  return (
    <div className="space-y-4">
      {turns.map((turn) => (
        <div
          key={turn.id}
          className="rounded-xl border border-zinc-200 bg-white/70 dark:border-zinc-700 dark:bg-zinc-950/40"
        >
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">
              Turn {turn.order}
            </span>
          </div>
          <div className="space-y-3 px-3 py-3">
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                User
              </h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {turn.userMessage}
              </p>
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Tool trace
              </h4>
              <TrajectoryStepCollapsibleList steps={turn.steps} />
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Assistant
              </h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {turn.assistantMessage || '(no assistant text)'}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
