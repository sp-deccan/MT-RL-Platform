import type { Trajectory, TrajectoryStep, TrajectoryTurn } from '../types'

function makeId(prefix: string, i: number): string {
  return `${prefix}-${i}-${Math.random().toString(36).slice(2, 9)}`
}

/** Avoid dummy steps that would break replay (e.g. destructive ops on seed data). */
function effectiveDummyTool(tool: string): string {
  if (tool === 'jira_delete_issue') return 'jira_search_issues'
  return tool
}

/**
 * Valid tool arguments for SQLite replay (`POST /api/session/replay-dummy-forks`).
 * Must match LangChain / Pydantic schemas in `backend/jira_tools.py`.
 */
export function dummyToolInputObject(
  tool: string,
  databaseId: string,
  side: 'A' | 'B',
  stepIndex: number,
): Record<string, unknown> {
  const pk = databaseId.trim().toUpperCase() || 'RL'
  switch (tool) {
    case 'jira_search_issues':
      return { project_key: pk, limit: Math.min(12 + stepIndex, 50) }
    case 'jira_get_issue':
      return { issue_key: 'RL-1' }
    case 'jira_list_projects':
      return {}
    case 'jira_get_project':
      return { project_key: pk }
    case 'jira_list_comments':
      return { issue_key: 'RL-1' }
    case 'jira_create_issue':
      return {
        project_key: pk,
        summary: `[Dummy ${side} · step ${stepIndex + 1}] Synthetic issue`,
        issue_type: 'Task',
        description: 'Created by dummy trajectory replay for QC / explorer.',
        status: 'To Do',
        priority: 'Medium',
      }
    case 'jira_update_issue':
      return {
        issue_key: 'RL-1',
        summary:
          side === 'A'
            ? `Dummy A touched RL-1 (step ${stepIndex + 1})`
            : `Dummy B touched RL-1 (step ${stepIndex + 1})`,
      }
    case 'jira_add_comment':
      return {
        issue_key: 'RL-1',
        author: side === 'A' ? 'dummy-a' : 'dummy-b',
        body: `Offline dummy comment — trajectory ${side}, step ${stepIndex + 1}.`,
      }
    case 'jira_transition_issue': {
      const cycle = ['To Do', 'In Progress', 'Done', 'Blocked'] as const
      return {
        issue_key: 'RL-1',
        new_status: cycle[stepIndex % cycle.length]!,
      }
    }
    default:
      return { project_key: pk, limit: 15 }
  }
}

/**
 * Produces two alternate dummy trajectories using the selected DB and tools.
 * Inputs are replayable on the backend so QC / DB explorer match trajectory A & B.
 */
export function generateDummyTrajectories(
  prompt: string,
  databaseId: string,
  toolNames: string[],
): { A: Trajectory; B: Trajectory } {
  const tools =
    toolNames.length > 0
      ? toolNames.map(effectiveDummyTool)
      : ['jira_search_issues', 'jira_get_issue']

  const n = Math.min(4, Math.max(2, tools.length))
  const stepsA: TrajectoryStep[] = []
  const stepsB: TrajectoryStep[] = []

  for (let i = 0; i < n; i++) {
    const tool = tools[i % tools.length]!
    const inputA = dummyToolInputObject(tool, databaseId, 'A', i)
    const inputB = dummyToolInputObject(tool, databaseId, 'B', i)
    stepsA.push({
      id: makeId('a', i),
      order: i + 1,
      tool,
      input: JSON.stringify(inputA, null, 2),
      output: `[Dummy A · ${tool}] Project ${databaseId} step #${i + 1}: replayable payload for SQLite sync.`,
    })
    stepsB.push({
      id: makeId('b', i),
      order: i + 1,
      tool,
      input: JSON.stringify(inputB, null, 2),
      output: `[Dummy B · ${tool}] Alternate path on ${databaseId} step ${i + 1}: replayable payload for SQLite sync.`,
    })
  }

  const short = prompt.trim().slice(0, 200) || '(empty prompt)'

  const wrap = (
    id: 'A' | 'B',
    label: string,
    steps: TrajectoryStep[],
    finalResponse: string,
  ): Trajectory => {
    const turn: TrajectoryTurn = {
      id: `dummy-turn-${id}`,
      order: 1,
      userMessage: prompt.trim() || '(empty prompt)',
      assistantMessage: finalResponse,
      steps,
    }
    return { id, label, turns: [turn], finalResponse, steps }
  }

  return {
    A: wrap(
      'A',
      'Trajectory A',
      stepsA,
      `[Dummy final · A] Answer for project ${databaseId} using ${tools.join(', ')}. User asked: "${short}"`,
    ),
    B: wrap(
      'B',
      'Trajectory B',
      stepsB,
      `[Dummy final · B] Different reasoning for ${databaseId}; tools: ${tools.join(', ')}. Query context: "${short}"`,
    ),
  }
}

/** Simulated per-step run: toggles ran and slightly tweaks output text */
export function dummyRunStepOutput(
  step: { tool: string; output: string },
  databaseId: string,
): string {
  return `${step.output}\n[Simulated run OK · project=${databaseId} · tool=${step.tool} · ${new Date().toISOString()}]`
}
