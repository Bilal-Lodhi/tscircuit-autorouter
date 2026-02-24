import { TypedRegion, TypedRegionPort } from "./HopCheckSolver"

type depthLimitedBfsArgs = {
  targetRegion: TypedRegion
  depthLimit: number
}

export const depthLimitedBfsSolver = (
  params: depthLimitedBfsArgs,
): TypedRegionPort[] => {
  const { targetRegion, depthLimit } = params
  if (depthLimit < 1) return []
  const visitedPortIds = new Set<string>()
  const queue: { port: TypedRegionPort; depth: number }[] =
    targetRegion.ports.map((port) => ({ port, depth: 1 }))
  const result: TypedRegionPort[] = []
  for (const { port } of queue) {
    visitedPortIds.add(port.portId)
  }

  while (queue.length > 0) {
    const { port, depth } = queue.shift()!
    if (depth === depthLimit) {
      result.push(port)
      continue
    }

    const nextRegionPort = [port.region1.ports, port.region2.ports].flat()

    for (const nextPort of nextRegionPort) {
      if (visitedPortIds.has(nextPort.portId)) {
        continue
      }
      visitedPortIds.add(nextPort.portId)
      queue.push({ port: nextPort, depth: depth + 1 })
    }
  }

  return result
}
