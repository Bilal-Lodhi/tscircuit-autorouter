import { scoreCandidate } from "./scoreCandidate"
import { DepthLimitedBfsCandidate } from "./types"

/**
 * Selects the best candidate from a list of DepthLimitedBfsCandidates based on their scores.
 * The candidate with the highest score is returned as the best candidate.
 * If there are no candidates, an error is thrown.
 */
export const selectBestCandidate = (
  candidates: DepthLimitedBfsCandidate[],
): DepthLimitedBfsCandidate => {
  if (candidates.length === 0) {
    throw new Error("No candidates to select from")
  }

  let bestCandidate = candidates[0]
  let bestScore = scoreCandidate(bestCandidate)

  for (const candidate of candidates) {
    const currentScore = scoreCandidate(candidate)
    if (currentScore > bestScore) {
      bestScore = currentScore
      bestCandidate = candidate
    }
  }

  return bestCandidate
}
