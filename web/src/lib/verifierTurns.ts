export type VerifierTurnDraft = {
  traceAi: string
  endStateAi: string
  traceIdeal: string
  endStateIdeal: string
}

export function emptyVerifierTurn(): VerifierTurnDraft {
  return {
    traceAi: '',
    endStateAi: '',
    traceIdeal: '',
    endStateIdeal: '',
  }
}

export function createVerifiersByTurn(count: number): VerifierTurnDraft[] {
  const n = Math.max(1, count)
  return Array.from({ length: n }, () => emptyVerifierTurn())
}
