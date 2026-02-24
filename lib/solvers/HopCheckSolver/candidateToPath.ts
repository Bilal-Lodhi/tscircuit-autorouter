import { DepthLimitedBfsCandidate, TypedRegionPort } from "./types"

/**
 * Converts a DepthLimitedBfsCandidate into a TypedRegionPort path.
 * Traverses parent links up to the root candidate, then reverses the path
 * so the order is from start to destination.
 */
export const candidateToPath = (
  candidate: DepthLimitedBfsCandidate,
): TypedRegionPort[] => {
  const path: TypedRegionPort[] = []
  let current: DepthLimitedBfsCandidate | null = candidate
  while (current) {
    path.push(current.portPoint)
    current = current.parent
  }
  return path.reverse()
}
