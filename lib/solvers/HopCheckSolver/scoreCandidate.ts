import { DepthLimitedBfsCandidate } from "./types"

/**
 * Scores a DepthLimitedBfsCandidate based on the presence of cramped port points in its path.
 * Each cramped port point decreases the score by 10,
 * while each non-cramped port point increases the score by 5.
 * The total score is calculated by traversing up the candidate's parent links
 * and evaluating each port point along the path.
 */
export const scoreCandidate = (candidate: DepthLimitedBfsCandidate): number => {
  let score = 0
  let current: DepthLimitedBfsCandidate | null = candidate
  while (current) {
    const p = current.portPoint

    if (p.d.cramped) {
      score -= 10
    } else {
      score += 5
    }

    current = current.parent
  }
  return score
}
