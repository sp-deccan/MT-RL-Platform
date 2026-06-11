const STORAGE_KEY = 'rl-platform-jira-session-id'

/** Which fork of the session SQLite files the explorer or tool list reads (A / B / ideal). */
export type RlDbFork = 'A' | 'B' | 'ideal'

/** Headers required by the backend for any route that touches the per-episode SQLite DB. */
export function rlSessionHeaders(dbFork?: RlDbFork): Record<string, string> {
  const h: Record<string, string> = { 'X-RL-Session-Id': getRlSessionId() }
  if (dbFork !== undefined) {
    h['X-RL-Db-Fork'] = dbFork
  }
  return h
}

export function getRlSessionId(): string {
  let id = sessionStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

/** Start a new RL episode (new isolated DB file on next API call). Call after successful golden submit. */
export function rotateRlSessionId(): string {
  const id = crypto.randomUUID()
  sessionStorage.setItem(STORAGE_KEY, id)
  return id
}
