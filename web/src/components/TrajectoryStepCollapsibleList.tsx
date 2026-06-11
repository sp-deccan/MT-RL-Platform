import { useMemo } from 'react'
import type { TrajectoryStep } from '../types'

function parseToolInput(input: string): { kind: 'json'; obj: Record<string, unknown> } | { kind: 'text'; raw: string } {
  const t = input.trim()
  if (!t) return { kind: 'text', raw: '' }
  try {
    const v = JSON.parse(t) as unknown
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return { kind: 'json', obj: v as Record<string, unknown> }
    }
    return { kind: 'text', raw: t }
  } catch {
    return { kind: 'text', raw: input }
  }
}

function formatOutput(out: string): string {
  const t = out.trim()
  if (!t) return '(empty)'
  try {
    const v = JSON.parse(t) as unknown
    return JSON.stringify(v, null, 2)
  } catch {
    return out
  }
}

function outputOneLinePreview(out: string, max = 72): string {
  const line = out.trim().split(/\r?\n/)[0] ?? ''
  if (line.length <= max) return line || '(no output)'
  return `${line.slice(0, max)}…`
}

function ArgumentsBlock({ input }: { input: string }) {
  const parsed = useMemo(() => parseToolInput(input), [input])

  if (parsed.kind === 'json') {
    const entries = Object.entries(parsed.obj)
    if (entries.length === 0) {
      return (
        <p className="text-xs italic text-zinc-500">No parameters (empty object)</p>
      )
    }
    return (
      <dl className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key}>
            <dt className="font-mono text-xs font-medium text-violet-700 dark:text-violet-400">
              {key}
            </dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {typeof val === 'object' && val !== null
                ? JSON.stringify(val)
                : String(val)}
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-100 bg-zinc-50 p-2 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
      {parsed.raw || '(empty)'}
    </pre>
  )
}

function OutputBlock({ output }: { output: string }) {
  const pretty = useMemo(() => formatOutput(output), [output])
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-100 bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
      {pretty}
    </pre>
  )
}

export function TrajectoryStepCollapsibleList({
  steps,
}: {
  steps: TrajectoryStep[]
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No tool steps in this trajectory.</p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="font-medium uppercase tracking-wide">
          Tool trace ({steps.length} step{steps.length === 1 ? '' : 's'})
        </span>
        <span>Click a step to expand arguments and output</span>
      </div>
      <div className="space-y-1.5">
        {steps.map((s) => (
          <details
            key={s.id}
            className="group rounded-lg border border-zinc-200 bg-white open:border-violet-300 open:shadow-sm dark:border-zinc-700 dark:bg-zinc-950/60 dark:open:border-violet-700"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {s.order}
              </span>
              <span className="shrink-0 font-mono text-xs font-semibold text-violet-700 dark:text-violet-400">
                {s.tool}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {outputOneLinePreview(s.output)}
              </span>
              <span className="inline-block shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-90 dark:text-zinc-500">
                ▶
              </span>
            </summary>
            <div className="space-y-3 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Arguments
                </h4>
                <ArgumentsBlock input={s.input} />
              </div>
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Output
                </h4>
                <OutputBlock output={s.output} />
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
