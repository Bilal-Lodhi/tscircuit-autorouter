import { DepthLimitedBfsCandidate, TypedRegionPort } from "./types"

/**
 * Converts a DepthLimitedBfsCandidate into a path of TypedRegionPorts by traversing up the parent links until the root candidate is reached. The resulting path is reversed to provide the correct order from the starting point to the target region.
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
