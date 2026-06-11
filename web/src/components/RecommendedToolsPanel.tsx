import { recommendedToolsForTurn } from '../lib/recommendedTools'

type RecommendedToolsPanelProps = {
  turnIndex: number
  userMessage: string
  selectedTools: string[]
  /** Tools already present in the ideal trace for this turn. */
  usedTools?: string[]
}

export function RecommendedToolsPanel({
  turnIndex,
  userMessage,
  selectedTools,
  usedTools = [],
}: RecommendedToolsPanelProps) {
  const recommended = recommendedToolsForTurn(userMessage, selectedTools)
  const used = new Set(usedTools)

  if (recommended.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/30">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Recommended tools — turn {turnIndex + 1}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {userMessage.trim()
            ? 'No specific tools suggested for this turn (e.g. summary-only). Add steps manually if needed.'
            : 'Enter a user message for this turn to see tool suggestions.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-violet-200/80 bg-violet-50/50 px-4 py-3 dark:border-violet-800/60 dark:bg-violet-950/20">
      <p className="text-xs font-medium uppercase tracking-wide text-violet-800 dark:text-violet-300">
        Recommended tools — turn {turnIndex + 1}
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Based on the user message for this turn. Use these when building the ideal
        trace.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {recommended.map((tool) => {
          const inIdeal = used.has(tool)
          return (
            <span
              key={tool}
              className={
                inIdeal
                  ? 'inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 font-mono text-xs font-medium text-white'
                  : 'inline-flex items-center gap-1 rounded-full border border-violet-300 bg-white px-3 py-1 font-mono text-xs font-medium text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'
              }
            >
              {tool}
              {inIdeal ? (
                <span className="text-[10px] font-sans opacity-90">in ideal</span>
              ) : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}
