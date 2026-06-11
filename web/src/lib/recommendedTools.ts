import { AVAILABLE_TOOLS } from '../constants'

const TOOL_SIGNALS: { tool: (typeof AVAILABLE_TOOLS)[number]; patterns: RegExp[] }[] =
  [
    {
      tool: 'jira_search_issues',
      patterns: [
        /\blist\b/i,
        /\bevery issue/i,
        /\bsearch\b/i,
        /\bfind\b/i,
        /\bopen issues?\b/i,
        /\bfilter\b/i,
        /\bstill\b/i,
      ],
    },
    {
      tool: 'jira_get_issue',
      patterns: [/\bget\b.*\bissue/i, /\blook up\b/i, /\bdetails?\b/i, /\bcheck\b/i],
    },
    {
      tool: 'jira_update_issue',
      patterns: [/\bassign\b/i, /\bupdate\b/i, /\bset\b.*\bassignee/i],
    },
    {
      tool: 'jira_transition_issue',
      patterns: [
        /\bmove\b/i,
        /\btransition\b/i,
        /\bin progress\b/i,
        /\bto do\b/i,
        /\bstatus\b/i,
      ],
    },
    {
      tool: 'jira_add_comment',
      patterns: [/\bcomment\b/i, /\bnote\b/i],
    },
    {
      tool: 'jira_create_issue',
      patterns: [/\bcreate\b.*\bissue/i, /\bnew issue/i],
    },
    {
      tool: 'jira_delete_issue',
      patterns: [/\bdelete\b.*\bissue/i, /\bremove\b.*\bissue/i],
    },
    {
      tool: 'jira_list_projects',
      patterns: [/\blist\b.*\bprojects?\b/i],
    },
    {
      tool: 'jira_get_project',
      patterns: [/\bget\b.*\bproject/i, /\bproject details/i],
    },
    {
      tool: 'jira_list_comments',
      patterns: [/\blist\b.*\bcomments?\b/i, /\bread\b.*\bcomments?\b/i],
    },
  ]

/**
 * Suggest JIRA tools for a single conversation turn based on the user message.
 * Only returns tools that are in the annotator's selected tool pool.
 */
export function recommendedToolsForTurn(
  userMessage: string,
  selectedTools: string[],
): string[] {
  const pool = new Set(selectedTools)
  const text = userMessage.trim()
  if (!text || pool.size === 0) return []

  const matched: string[] = []
  for (const { tool, patterns } of TOOL_SIGNALS) {
    if (!pool.has(tool)) continue
    if (patterns.some((p) => p.test(text))) {
      matched.push(tool)
    }
  }

  if (matched.length > 0) return matched

  if (/\b(summarize|summary|everything you changed)\b/i.test(text)) {
    return []
  }

  const fallback = ['jira_search_issues', 'jira_get_issue'].filter((t) =>
    pool.has(t),
  )
  return fallback
}
