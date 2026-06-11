import type { TrajectoryStep } from '../types'

/**
 * Template verifiers derived from the ideal trace and final answer.
 * Replace with an LLM call when you want AI-written checks.
 */
export function generateVerifiersFromIdeal(input: {
  idealFinalResponse: string
  idealSteps: TrajectoryStep[]
  databaseId: string
  prompt: string
  turnOrder?: number
}): { trace: string; endState: string } {
  const turnLabel =
    input.turnOrder != null ? ` — turn ${input.turnOrder}` : ''
  const tools = input.idealSteps.map((s) => s.tool)
  const uniqueTools = [...new Set(tools)]
  const orderLine =
    tools.length > 0
      ? tools.join(' → ')
      : '(no steps — only final response given)'

  const promptExcerpt =
    input.prompt.trim().slice(0, 240) || '(empty prompt in section 2)'

  const answerExcerpt =
    input.idealFinalResponse.trim().slice(0, 320) ||
    '(empty ideal final response)'

  const trace = `## Trace verifier${turnLabel} (generated — edit freely)

Check that the executed trajectory satisfies:

1. **Tool order**: The sequence of tool calls should match the ideal order:
   ${orderLine}

2. **Tools used** (unique): ${uniqueTools.length ? uniqueTools.join(', ') : '—'}

3. **Project scope**: Steps that touch JIRA data should target project \`${input.databaseId}\` where applicable.

4. **Step outputs**: Intermediate outputs should be plausible given the tool inputs (compare shape/content to the ideal trace in section 3).

---

_Ideal tool sequence reference:_ ${tools.length ? tools.map((t, i) => `${i + 1}. ${t}`).join('; ') : 'none'}
`

  const endState = `## End-state verifier${turnLabel} (generated — edit freely)

Check the **final model answer** (last assistant message / aggregated result):

1. **Addresses the prompt**: The response should satisfy the user request summarized as:
   "${promptExcerpt}${input.prompt.trim().length > 240 ? '…' : ''}"

2. **Consistency with ideal answer**: The ideal reference text below should be treated as the gold standard unless your rubric intentionally diverges:
   """
   ${answerExcerpt}${input.idealFinalResponse.trim().length > 320 ? '…' : ''}
   """

3. **Project grounding**: Where facts depend on \`${input.databaseId}\`, the answer should not contradict the intended retrieval path from the ideal trajectory.

4. **Format**: Answer should be self-contained and readable (no dangling references to unstated tool-only artifacts unless acceptable for your task).
`

  return { trace: trace.trimEnd(), endState: endState.trimEnd() }
}
