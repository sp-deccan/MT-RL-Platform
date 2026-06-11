import type { Trajectory } from '../types'
import { flattenTrajectorySteps } from '../types'
import type { IdealTurnDraft } from './idealStorage'
import type { VerifierTurnDraft } from './verifierTurns'

export const EXAMPLE_USER_TURNS = [
  'In the RL project, list every issue that is still To Do or In Progress.',
  'Assign RL-2 to alice and move it to In Progress.',
  'Add a comment on RL-1 that the LangChain agent wiring is ready for QA review, then summarize everything you changed.',
] as const

/** @deprecated Use EXAMPLE_USER_TURNS — kept for prompt field compatibility */
export const EXAMPLE_PROMPT = EXAMPLE_USER_TURNS.join('\n\n')

export const EXAMPLE_SELECTED_TOOLS = [
  'jira_search_issues',
  'jira_get_issue',
  'jira_update_issue',
  'jira_add_comment',
  'jira_transition_issue',
] as const

const EXAMPLE_TURNS_A = [
  {
    id: 'ex-a-turn-1',
    order: 1,
    userMessage: EXAMPLE_USER_TURNS[0]!,
    assistantMessage:
      'Open RL issues: **RL-1** is In Progress (assigned to alice) and **RL-2** is To Do (unassigned).',
    steps: [
      {
        id: 'ex-a-1',
        order: 1,
        turnOrder: 1,
        tool: 'jira_search_issues',
        input: JSON.stringify(
          { project_key: 'RL', status: 'To Do', limit: 20 },
          null,
          2,
        ),
        output: JSON.stringify(
          {
            matches: [
              {
                key: 'RL-2',
                summary: 'Add RLHF ranking UI',
                status: 'To Do',
                assignee: null,
              },
            ],
            count: 1,
          },
          null,
          2,
        ),
      },
      {
        id: 'ex-a-2',
        order: 2,
        turnOrder: 1,
        tool: 'jira_search_issues',
        input: JSON.stringify(
          { project_key: 'RL', status: 'In Progress', limit: 20 },
          null,
          2,
        ),
        output: JSON.stringify(
          {
            matches: [
              {
                key: 'RL-1',
                summary: 'Wire LangChain tool-calling agent',
                status: 'In Progress',
                assignee: 'alice',
              },
            ],
            count: 1,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'ex-a-turn-2',
    order: 2,
    userMessage: EXAMPLE_USER_TURNS[1]!,
    assistantMessage:
      'Done — **RL-2** is now assigned to alice and in **In Progress**.',
    steps: [
      {
        id: 'ex-a-3',
        order: 3,
        turnOrder: 2,
        tool: 'jira_update_issue',
        input: JSON.stringify(
          { issue_key: 'RL-2', assignee: 'alice' },
          null,
          2,
        ),
        output: JSON.stringify(
          { updated: true, key: 'RL-2', assignee: 'alice' },
          null,
          2,
        ),
      },
      {
        id: 'ex-a-4',
        order: 4,
        turnOrder: 2,
        tool: 'jira_transition_issue',
        input: JSON.stringify(
          { issue_key: 'RL-2', new_status: 'In Progress' },
          null,
          2,
        ),
        output: JSON.stringify(
          { transitioned: true, key: 'RL-2', status: 'In Progress' },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'ex-a-turn-3',
    order: 3,
    userMessage: EXAMPLE_USER_TURNS[2]!,
    assistantMessage: `Summary of changes:

- **RL-2**: assigned to alice and moved to In Progress.
- **RL-1**: comment added — "LangChain agent wiring is ready for QA review."`,
    steps: [
      {
        id: 'ex-a-5',
        order: 5,
        turnOrder: 3,
        tool: 'jira_add_comment',
        input: JSON.stringify(
          {
            issue_key: 'RL-1',
            author: 'annotator',
            body: 'LangChain agent wiring is ready for QA review.',
          },
          null,
          2,
        ),
        output: JSON.stringify(
          {
            comment_id: 'cmt-ex-a-1',
            issue_key: 'RL-1',
            created: true,
          },
          null,
          2,
        ),
      },
    ],
  },
]

const EXAMPLE_TURNS_B = [
  {
    id: 'ex-b-turn-1',
    order: 1,
    userMessage: EXAMPLE_USER_TURNS[0]!,
    assistantMessage:
      'I found two active RL issues: RL-1 (In Progress, alice) and RL-2 (To Do).',
    steps: [
      {
        id: 'ex-b-1',
        order: 1,
        turnOrder: 1,
        tool: 'jira_get_issue',
        input: JSON.stringify({ issue_key: 'RL-1' }, null, 2),
        output: JSON.stringify(
          {
            key: 'RL-1',
            project_key: 'RL',
            summary: 'Wire LangChain tool-calling agent',
            status: 'In Progress',
            assignee: 'alice',
            priority: 'High',
          },
          null,
          2,
        ),
      },
      {
        id: 'ex-b-2',
        order: 2,
        turnOrder: 1,
        tool: 'jira_get_issue',
        input: JSON.stringify({ issue_key: 'RL-2' }, null, 2),
        output: JSON.stringify(
          {
            key: 'RL-2',
            project_key: 'RL',
            summary: 'Add RLHF ranking UI',
            status: 'To Do',
            assignee: null,
            priority: 'Medium',
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'ex-b-turn-2',
    order: 2,
    userMessage: EXAMPLE_USER_TURNS[1]!,
    assistantMessage:
      'RL-2 transitioned to In Progress first, then assignee set to alice.',
    steps: [
      {
        id: 'ex-b-3',
        order: 3,
        turnOrder: 2,
        tool: 'jira_transition_issue',
        input: JSON.stringify(
          { issue_key: 'RL-2', new_status: 'In Progress' },
          null,
          2,
        ),
        output: JSON.stringify(
          { transitioned: true, key: 'RL-2', status: 'In Progress' },
          null,
          2,
        ),
      },
      {
        id: 'ex-b-4',
        order: 4,
        turnOrder: 2,
        tool: 'jira_update_issue',
        input: JSON.stringify(
          { issue_key: 'RL-2', assignee: 'alice' },
          null,
          2,
        ),
        output: JSON.stringify(
          { updated: true, key: 'RL-2', assignee: 'alice' },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'ex-b-turn-3',
    order: 3,
    userMessage: EXAMPLE_USER_TURNS[2]!,
    assistantMessage:
      'Added the QA comment on RL-1. Net result: RL-2 is In Progress with alice; RL-1 has your QA note.',
    steps: [
      {
        id: 'ex-b-5',
        order: 5,
        turnOrder: 3,
        tool: 'jira_add_comment',
        input: JSON.stringify(
          {
            issue_key: 'RL-1',
            author: 'annotator',
            body: 'LangChain agent wiring is ready for QA review.',
          },
          null,
          2,
        ),
        output: JSON.stringify(
          {
            comment_id: 'cmt-ex-b-1',
            issue_key: 'RL-1',
            created: true,
          },
          null,
          2,
        ),
      },
    ],
  },
]

function buildExampleTrajectory(
  id: 'A' | 'B',
  label: string,
  turns: typeof EXAMPLE_TURNS_A,
): Trajectory {
  const steps = flattenTrajectorySteps(turns)
  return {
    id,
    label,
    turns,
    steps,
    finalResponse: turns[turns.length - 1]!.assistantMessage,
  }
}

export const EXAMPLE_TRAJECTORY_A = buildExampleTrajectory(
  'A',
  'Trajectory A',
  EXAMPLE_TURNS_A,
)

export const EXAMPLE_TRAJECTORY_B = buildExampleTrajectory(
  'B',
  'Trajectory B',
  EXAMPLE_TURNS_B,
)

/** Demo ideal traces — one per turn, derived from trajectory A. */
export const EXAMPLE_IDEAL_BY_TURN: IdealTurnDraft[] = EXAMPLE_TURNS_A.map(
  (turn) => ({
    source: 'A' as const,
    steps: turn.steps.map((s, i) => ({
      ...s,
      id: `ex-ideal-a-${turn.order}-${i}`,
      ran: false,
    })),
    finalResponse: turn.assistantMessage,
  }),
)

/** Demo verifiers — one trace + end-state pair per conversation turn. */
export const EXAMPLE_VERIFIERS_BY_TURN: VerifierTurnDraft[] = [
  {
    traceAi: `## Trace verifier — turn 1 (example)

1. Agent must call \`jira_search_issues\` (or equivalent) scoped to project **RL**.
2. Both **To Do** and **In Progress** statuses should be queried (two searches or one combined filter).
3. Response should mention **RL-1** (In Progress) and **RL-2** (To Do) from seed data.`,
    endStateAi: `## End-state verifier — turn 1 (example)

Final answer for turn 1 should list open RL issues with keys and statuses. Must not invent issue keys outside the RL project.`,
    traceIdeal: `## Trace verifier — turn 1 (ideal)

- [ ] \`jira_search_issues\` with \`project_key: RL\` for To Do
- [ ] \`jira_search_issues\` with \`project_key: RL\` for In Progress
- [ ] Assistant cites RL-1 and RL-2 with correct statuses`,
    endStateIdeal: `## End-state verifier — turn 1 (ideal)

User asked to list open RL work. Gold answer names RL-1 (In Progress, alice) and RL-2 (To Do, unassigned).`,
  },
  {
    traceAi: `## Trace verifier — turn 2 (example)

1. \`jira_update_issue\` on **RL-2** with \`assignee: alice\`.
2. \`jira_transition_issue\` on **RL-2** to **In Progress**.
3. Order may vary; both mutations must succeed.`,
    endStateAi: `## End-state verifier — turn 2 (example)

Turn 2 reply should confirm RL-2 is assigned to alice and in In Progress.`,
    traceIdeal: `## Trace verifier — turn 2 (ideal)

- [ ] Update RL-2 assignee → alice
- [ ] Transition RL-2 → In Progress
- [ ] No unrelated issues modified`,
    endStateIdeal: `## End-state verifier — turn 2 (ideal)

Confirms RL-2 assignment and status change only; concise confirmation text.`,
  },
  {
    traceAi: `## Trace verifier — turn 3 (example)

1. \`jira_add_comment\` on **RL-1** with body mentioning QA / LangChain agent wiring.
2. No spurious deletes or transitions on turn 3 unless required by prompt.`,
    endStateAi: `## End-state verifier — turn 3 (example)

Must include summary of all session changes: RL-2 assignee/status, RL-1 comment, and reference turn 1 discovery.`,
    traceIdeal: `## Trace verifier — turn 3 (ideal)

- [ ] Comment on RL-1: "LangChain agent wiring is ready for QA review."
- [ ] Summary covers RL-1 comment + RL-2 updates from prior turns`,
    endStateIdeal: `## End-state verifier — turn 3 (ideal)

Gold summary lists RL-2 (alice, In Progress) and RL-1 QA comment; readable bullet or short paragraph.`,
  },
]
