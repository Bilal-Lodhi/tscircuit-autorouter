import { DepthLimitedBfsCandidate, TypedRegion, TypedRegionPort } from "./types"

type DepthLimitedBfsArgs = {
  targetRegion: TypedRegion
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

/**
 * Performs a breadth-first search (BFS) starting from the ports of the target region,
 * exploring neighboring regions through their ports up to a specified depth limit.
 * The function returns the port points at the nth degree of separation, all visited
 * port points, and candidates at the nth degree that do not share an obstacle with the
 * target region. The BFS can optionally ignore cramped port points during traversal.
 */
export const depthLimitedBfs = (
  params: DepthLimitedBfsArgs,
): {
  portPointsAtNthDegree: TypedRegionPort[]
  visitedPortPoints: TypedRegionPort[]
  outputCandidatesAtNthDegreeWithoutObstacleShare: DepthLimitedBfsCandidate[]
  visitedCandidates: DepthLimitedBfsCandidate[]
} => {
  const { targetRegion, depthLimit, shouldIgnoreCrampedPortPoints } = params
  if (depthLimit < 1)
    return {
      portPointsAtNthDegree: [],
      visitedPortPoints: [],
      outputCandidatesAtNthDegreeWithoutObstacleShare: [],
      visitedCandidates: [],
    }
  const visitedCandidateByPort = new Map<
    TypedRegionPort,
    DepthLimitedBfsCandidate
  >()
  const queue: DepthLimitedBfsCandidate[] = targetRegion.ports.map((port) => {
    const candidate: DepthLimitedBfsCandidate = {
      portPoint: port,
      depth: 1,
      parent: null,
    }
    visitedCandidateByPort.set(port, candidate)
    return candidate
  })
  const resultCandidates: DepthLimitedBfsCandidate[] = []

  while (queue.length > 0) {
    const currentCandidate = queue.shift()!
    const { portPoint: port, depth } = currentCandidate
    if (depth === depthLimit) {
      resultCandidates.push(currentCandidate)
      continue
    }

    let nextRegionPort = [
      port.region1.ports,
      port.region2.ports,
    ].flat() as TypedRegionPort[]
    if (shouldIgnoreCrampedPortPoints) {
      nextRegionPort = nextRegionPort.filter((port) => !port.d.cramped)
    }

    for (const nextPort of nextRegionPort) {
      if (visitedCandidateByPort.has(nextPort)) {
        continue
      }
      const nextCandidate: DepthLimitedBfsCandidate = {
        portPoint: nextPort,
        depth: depth + 1,
        parent: currentCandidate,
      }
      visitedCandidateByPort.set(nextPort, nextCandidate)
      queue.push(nextCandidate)
    }
  }

  const visitedCandidates = Array.from(visitedCandidateByPort.values())
  const outputCandidatesAtNthDegreeWithoutObstacleShare = resultCandidates.filter(
    (candidate) => {
      const candidateRegions = [
        candidate.portPoint.region1,
        candidate.portPoint.region2,
      ]
      return !candidateRegions.some((region) => region.d._containsObstacle)
    },
  )
  return {
    portPointsAtNthDegree: resultCandidates.map(
      (candidate) => candidate.portPoint,
    ),
    visitedPortPoints: visitedCandidates.map(
      (candidate) => candidate.portPoint,
    ),
    outputCandidatesAtNthDegreeWithoutObstacleShare,
    visitedCandidates,
  }
}
