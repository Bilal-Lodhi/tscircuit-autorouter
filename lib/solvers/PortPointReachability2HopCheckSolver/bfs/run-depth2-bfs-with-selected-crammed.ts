import type { CapacityMeshNodeId } from "lib/types"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { isPortTouchingObstacle } from "../check/is-port-touching-obstacle"
import { getPortIdsBetweenNodes } from "../ports/get-port-ids-between-nodes"

/** Runs a fresh 2-hop BFS using only the selected crammed ports. */
export const runDepth2BfsWithSelectedCrammed = ({
  solver,
  selectedCrammedPortPointIds,
}: {
  solver: PortPointReachability2HopCheckSolver
  selectedCrammedPortPointIds: Set<string>
}): {
  discoveredDepthByNodeId: Map<CapacityMeshNodeId, number>
  discoveredDepthByEdgeKey: Map<string, number>
  discoveredPortIdsByDegree: Map<0 | 1 | 2, Set<string>>
  chokeBlockedAtDegree2: boolean
} => {
  const discoveredDepthByNodeId = new Map<CapacityMeshNodeId, number>()
  const discoveredDepthByEdgeKey = new Map<string, number>()
  const discoveredPortIdsByDegree: Map<0 | 1 | 2, Set<string>> = new Map([
    [0, new Set()],
    [1, new Set()],
    [2, new Set()],
  ])

  if (!solver.currentAnchorNodeId) {
    return {
      discoveredDepthByNodeId,
      discoveredDepthByEdgeKey,
      discoveredPortIdsByDegree,
      chokeBlockedAtDegree2: false,
    }
  }

  discoveredDepthByNodeId.set(solver.currentAnchorNodeId, 0)
  let frontier: CapacityMeshNodeId[] = [solver.currentAnchorNodeId]

  for (const degree of [1, 2] as const) {
    const nextFrontier: CapacityMeshNodeId[] = []

    for (const nodeId of frontier) {
      const neighbors = solver.adjacencyByNodeId.get(nodeId)
      if (!neighbors) continue

      for (const neighborId of neighbors) {
        if (discoveredDepthByNodeId.has(neighborId)) continue

        discoveredDepthByNodeId.set(neighborId, degree)
        const edgeKey = solver.getEdgeKey(nodeId, neighborId)
        const prevDegree = discoveredDepthByEdgeKey.get(edgeKey)
        if (prevDegree === undefined || degree < prevDegree) {
          discoveredDepthByEdgeKey.set(edgeKey, degree)
        }

        const { portIds } = getPortIdsBetweenNodes({
          solver,
          nodeIdA: nodeId,
          nodeIdB: neighborId,
          activeCrammedPortPointIds: selectedCrammedPortPointIds,
        })

        if (portIds.length === 0) continue
        for (const portId of portIds) {
          discoveredPortIdsByDegree.get(degree)?.add(portId)
        }

        nextFrontier.push(neighborId)
      }
    }

    frontier = nextFrontier
  }

  const degree2Ports = discoveredPortIdsByDegree.get(2) ?? new Set()
  let chokeBlockedAtDegree2 = degree2Ports.size > 0
  for (const portId of degree2Ports) {
    if (!isPortTouchingObstacle({ solver, portId })) {
      chokeBlockedAtDegree2 = false
      break
    }
  }

  return {
    discoveredDepthByNodeId,
    discoveredDepthByEdgeKey,
    discoveredPortIdsByDegree,
    chokeBlockedAtDegree2,
  }
}
