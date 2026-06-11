export type TaskDifficulty = 'easy' | 'medium' | 'hard'

export type TaskMetadata = {
  category: string
  difficulty: TaskDifficulty
  domain: string
  taskType: string
  tags: string[]
  estimatedMinutes: number
}

export const TASK_CATEGORIES = [
  'Issue lifecycle',
  'Issue triage',
  'Sprint planning',
  'Reporting & search',
  'Bulk updates',
] as const

export const TASK_DIFFICULTIES: { id: TaskDifficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
]

export const TASK_DOMAINS = [
  'JIRA / project ops',
  'Customer support',
  'Engineering workflow',
  'Operations',
] as const

export const TASK_TYPES = [
  'Single-turn lookup',
  'Multi-turn workflow',
  'State mutation',
  'Mixed read/write',
] as const

/** Demo metadata pre-loaded in section 2. */
export const EXAMPLE_TASK_METADATA: TaskMetadata = {
  category: 'Issue lifecycle',
  difficulty: 'medium',
  domain: 'JIRA / project ops',
  taskType: 'Multi-turn workflow',
  tags: ['search', 'assignee', 'status', 'comment'],
  estimatedMinutes: 15,
}
