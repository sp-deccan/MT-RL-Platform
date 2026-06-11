import {
  TASK_CATEGORIES,
  TASK_DIFFICULTIES,
  TASK_DOMAINS,
  TASK_TYPES,
  type TaskMetadata,
} from '../lib/taskMetadata'

type TaskMetadataFieldsProps = {
  value: TaskMetadata
  onChange: (patch: Partial<TaskMetadata>) => void
  readOnly?: boolean
}

const fieldClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900'
const labelClass =
  'mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500'

export function TaskMetadataFields({
  value,
  onChange,
  readOnly = false,
}: TaskMetadataFieldsProps) {
  if (readOnly) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <span className={labelClass}>Category</span>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            {value.category}
          </p>
        </div>
        <div>
          <span className={labelClass}>Difficulty</span>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            {TASK_DIFFICULTIES.find((d) => d.id === value.difficulty)?.label ??
              value.difficulty}
          </p>
        </div>
        <div>
          <span className={labelClass}>Domain</span>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            {value.domain}
          </p>
        </div>
        <div>
          <span className={labelClass}>Task type</span>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            {value.taskType}
          </p>
        </div>
        <div>
          <span className={labelClass}>Est. time (min)</span>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">
            {value.estimatedMinutes}
          </p>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <span className={labelClass}>Tags</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {value.tags.length ? (
              value.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-sm text-zinc-500">—</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className={labelClass}>Category</label>
        <select
          value={value.category}
          onChange={(e) => onChange({ category: e.target.value })}
          className={fieldClass}
        >
          {TASK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Difficulty</label>
        <select
          value={value.difficulty}
          onChange={(e) =>
            onChange({ difficulty: e.target.value as TaskMetadata['difficulty'] })
          }
          className={fieldClass}
        >
          {TASK_DIFFICULTIES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Domain</label>
        <select
          value={value.domain}
          onChange={(e) => onChange({ domain: e.target.value })}
          className={fieldClass}
        >
          {TASK_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Task type</label>
        <select
          value={value.taskType}
          onChange={(e) => onChange({ taskType: e.target.value })}
          className={fieldClass}
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Est. time (min)</label>
        <input
          type="number"
          min={1}
          max={120}
          value={value.estimatedMinutes}
          onChange={(e) =>
            onChange({
              estimatedMinutes: Math.max(1, Number(e.target.value) || 1),
            })
          }
          className={fieldClass}
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={labelClass}>Tags (comma-separated)</label>
        <input
          type="text"
          value={value.tags.join(', ')}
          onChange={(e) =>
            onChange({
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="search, assignee, status"
          className={fieldClass}
        />
      </div>
    </div>
  )
}
