import type { Trajectory } from '../types'
import { rlSessionHeaders } from './rlSession'

export type SystemPromptOption = { id: string; label: string }

export type AgentRunResponse = {
  A: Trajectory
  B: Trajectory
  model: string
  system_prompt_file: string
  /** Full system prompt text used for both trajectories (same as agent session log). */
  system_prompt_text: string
  /** Relative path to JSON log under repo (server-side). */
  agent_log_file?: string | null
}

export type InvokeToolResponse = {
  ok: boolean
  output?: string
  error?: string
  suggestion?: string
}

export async function fetchSystemPrompts(): Promise<SystemPromptOption[]> {
  const r = await fetch('/api/prompts/system')
  if (!r.ok) throw new Error(`Prompts list failed: ${r.status}`)
  const data = (await r.json()) as { prompts: SystemPromptOption[] }
  return data.prompts ?? []
}

async function parseHttpError(r: Response): Promise<string> {
  const t = await r.text()
  try {
    const j = JSON.parse(t) as { detail?: string | unknown }
    if (typeof j.detail === 'string') return j.detail
  } catch {
    /* ignore */
  }
  return t || `HTTP ${r.status}`
}

export async function generateTaskPrompt(body: {
  project_key: string
  selected_tools: string[]
  metadata_summary: string | null
}): Promise<{ prompt: string; model: string }> {
  const r = await fetch('/api/prompts/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...rlSessionHeaders(),
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    throw new Error(await parseHttpError(r))
  }
  return (await r.json()) as { prompt: string; model: string }
}

export async function runRealAgent(body: {
  user_turns: string[]
  project_key: string
  selected_tools: string[]
  system_prompt_file: string
  metadata_summary: string | null
}): Promise<AgentRunResponse> {
  const r = await fetch('/api/agent/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...rlSessionHeaders(),
    },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { detail?: string | unknown }
      if (typeof j.detail === 'string') msg = j.detail
    } catch {
      /* use raw */
    }
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return JSON.parse(text) as AgentRunResponse
}

export async function invokeIdealTool(body: {
  tool: string
  arguments: Record<string, unknown>
}): Promise<InvokeToolResponse> {
  const r = await fetch('/api/ideal/invoke-tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...rlSessionHeaders(),
    },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { detail?: string | unknown }
      if (typeof j.detail === 'string') msg = j.detail
    } catch {
      /* use raw */
    }
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return JSON.parse(text) as InvokeToolResponse
}

export async function generateVerifiersAi(body: {
  project_key: string
  user_prompt: string
  ideal_steps: Array<{
    order: number
    tool: string
    input: string
    output: string
  }>
  ideal_final_response: string
}): Promise<{
  trace_verifier: string
  end_state_verifier: string
  verifier_log_file?: string
  verifier_system_prompt_file?: string
  verifier_system_prompt_text?: string
}> {
  const r = await fetch('/api/verifiers/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    throw new Error(await parseHttpError(r))
  }
  return (await r.json()) as {
    trace_verifier: string
    end_state_verifier: string
    verifier_log_file?: string
    verifier_system_prompt_file?: string
    verifier_system_prompt_text?: string
  }
}

export type SyncQcViewResult = {
  ok: boolean
  errors_a: Array<{ step_index: number; tool?: string; error: string }>
  errors_b: Array<{ step_index: number; tool?: string; error: string }>
  errors_ideal: Array<{ step_index: number; tool?: string; error: string }>
  synced_ab: boolean
  synced_ideal: boolean
}

/**
 * Align SQLite forks for QC: reset A/B and replay from step lists; optional ideal replay.
 */
export async function syncSessionForQcView(body: {
  steps_a: Array<{ tool: string; input: string; order?: number }>
  steps_b: Array<{ tool: string; input: string; order?: number }>
  steps_ideal: Array<{ tool: string; input: string; order?: number }>
}): Promise<SyncQcViewResult> {
  const r = await fetch('/api/session/sync-for-qc-view', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...rlSessionHeaders(),
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    throw new Error(await parseHttpError(r))
  }
  return (await r.json()) as SyncQcViewResult
}

export async function saveGoldenTask(
  payload: Record<string, unknown>,
): Promise<{ saved_to: string; session_db_reset?: boolean }> {
  const r = await fetch('/api/tasks/save-golden', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...rlSessionHeaders(),
    },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    throw new Error(await parseHttpError(r))
  }
  return (await r.json()) as { saved_to: string; session_db_reset?: boolean }
}
