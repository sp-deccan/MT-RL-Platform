export type QcReviewState = {
  promptRating: number | null
  promptRationale: string
  responseRating: number | null
  responseRationale: string
  idealTrajectoryRating: number | null
  idealTrajectoryRationale: string
  verifiersRating: number | null
  verifiersRationale: string
  overallRating: number | null
  overallRationale: string
}

export function createEmptyQcReview(): QcReviewState {
  return {
    promptRating: null,
    promptRationale: '',
    responseRating: null,
    responseRationale: '',
    idealTrajectoryRating: null,
    idealTrajectoryRationale: '',
    verifiersRating: null,
    verifiersRationale: '',
    overallRating: null,
    overallRationale: '',
  }
}

export type QcRlhfIssueLevel = 'no_issue' | 'minor_issue' | 'major_issue'

export type QcRlhfSideRubric = {
  instructionFollowing: QcRlhfIssueLevel | null
  instructionFollowingRationale: string
  accuracy: QcRlhfIssueLevel | null
  accuracyRationale: string
}

export type QcRlhfRubrics = {
  A: QcRlhfSideRubric
  B: QcRlhfSideRubric
}

/** Shape written under `qc_review` on golden submit. */
export function qcReviewToPayload(q: QcReviewState) {
  return {
    prompt: {
      rating: q.promptRating,
      rationale: q.promptRationale.trim(),
    },
    response: {
      rating: q.responseRating,
      rationale: q.responseRationale.trim(),
    },
    ideal_trajectory: {
      rating: q.idealTrajectoryRating,
      rationale: q.idealTrajectoryRationale.trim(),
    },
    verifiers: {
      rating: q.verifiersRating,
      rationale: q.verifiersRationale.trim(),
    },
    overall: {
      rating: q.overallRating,
      rationale: q.overallRationale.trim(),
    },
  }
}
