import { TypedRegion, TypedRegionPort } from "./HopCheckSolver"

type depthLimitedBfsArgs = {
  targetRegion: TypedRegion
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

export const depthLimitedBfs = (
  params: depthLimitedBfsArgs,
): {
  portPointsAtNthDegree: TypedRegionPort[]
  visitedPortPoints: TypedRegionPort[]
} => {
  const { targetRegion, depthLimit, shouldIgnoreCrampedPortPoints } = params
  if (depthLimit < 1)
    return { portPointsAtNthDegree: [], visitedPortPoints: [] }
  const visitedPort = new Set<TypedRegionPort>()
  const queue: { port: TypedRegionPort; depth: number }[] =
    targetRegion.ports.map((port) => ({ port, depth: 1 }))
  const result: TypedRegionPort[] = []
  for (const { port } of queue) {
    visitedPort.add(port)
  }

  while (queue.length > 0) {
    const { port, depth } = queue.shift()!
    if (depth === depthLimit) {
      result.push(port)
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
      if (visitedPort.has(nextPort)) {
        continue
      }
      visitedPort.add(nextPort)
      queue.push({ port: nextPort, depth: depth + 1 })
    }
  }

  return {
    portPointsAtNthDegree: result,
    visitedPortPoints: Array.from(visitedPort),
  }
}
