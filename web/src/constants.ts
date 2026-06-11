/** LangChain-bound JIRA tools (SQLite-backed on the API). */
export const AVAILABLE_TOOLS = [
  'jira_search_issues',
  'jira_get_issue',
  'jira_create_issue',
  'jira_update_issue',
  'jira_delete_issue',
  'jira_list_projects',
  'jira_get_project',
  'jira_add_comment',
  'jira_list_comments',
  'jira_transition_issue',
] as const

/** JIRA project keys in the local demo database (see backend/jira_store.py). */
export const DATABASES = [
  { id: 'RL', label: 'RL Platform' },
  { id: 'DEMO', label: 'Demo Space' },
  { id: 'ORD', label: 'Orders' },
  { id: 'INV', label: 'Inventory' },
] as const

/** Short intro above the side-by-side trajectory comparison. */
export const RLHF_COMPARISON_INTRO =
  'Compare the two final responses below. Rate each response, then use the scale to express an overall preference between A and B.'

/** Labels for the 1–7 slider: 1 = favor A, 7 = favor B. */
export const RLHF_OVERALL_SCALE_LABELS: Record<number, string> = {
  1: 'A is much better',
  2: 'A is clearly better',
  3: 'A is slightly better',
  4: 'Tie / similar quality',
  5: 'B is slightly better',
  6: 'B is clearly better',
  7: 'B is much better',
}
