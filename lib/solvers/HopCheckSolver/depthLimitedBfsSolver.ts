import { TypedRegion, TypedRegionPort } from "./HopCheckSolver"

type depthLimitedBfsArgs = {
  targetRegion: TypedRegion
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

export type DepthLimitedBfsCandidate = {
  portPoint: TypedRegionPort
  depth: number
  parent: DepthLimitedBfsCandidate | null
}

export const depthLimitedBfs = (
  params: depthLimitedBfsArgs,
): {
  portPointsAtNthDegree: TypedRegionPort[]
  visitedPortPoints: TypedRegionPort[]
  outputCandidatesAtNthDegreeWhoDoNotShareWithObstacle: DepthLimitedBfsCandidate[]
  visitedCandidates: DepthLimitedBfsCandidate[]
} => {
  const { targetRegion, depthLimit, shouldIgnoreCrampedPortPoints } = params
  if (depthLimit < 1)
    return {
      portPointsAtNthDegree: [],
      visitedPortPoints: [],
      outputCandidatesAtNthDegreeWhoDoNotShareWithObstacle: [],
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
  return {
    portPointsAtNthDegree: resultCandidates.map(
      (candidate) => candidate.portPoint,
    ),
    visitedPortPoints: visitedCandidates.map(
      (candidate) => candidate.portPoint,
    ),
    outputCandidatesAtNthDegreeWhoDoNotShareWithObstacle:
      resultCandidates.filter((candidate) => {
        const candidateRegions = [
          candidate.portPoint.region1,
          candidate.portPoint.region2,
        ]
        return !candidateRegions.some((region) => region.d._containsObstacle)
      }),
    visitedCandidates,
  }
}

const scoreCandidate = (candidate: DepthLimitedBfsCandidate): number => {
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
