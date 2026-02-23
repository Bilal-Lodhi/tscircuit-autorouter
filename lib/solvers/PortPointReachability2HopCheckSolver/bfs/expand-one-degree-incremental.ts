import type { CapacityMeshNodeId } from "lib/types"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { getPortIdsBetweenNodes } from "../ports/get-port-ids-between-nodes"

/** Expands one BFS frontier node for a single degree. */
export const expandOneDegreeIncremental = ({
  solver,
  nextDegree,
}: {
  solver: PortPointReachability2HopCheckSolver
  nextDegree: 1 | 2
}): boolean => {
  if (solver.activeExpandDegree !== nextDegree) {
    solver.activeExpandDegree = nextDegree
    solver.frontierCursor = 0
    solver.nextFrontier = []
  }

  const frontierNodeId = solver.frontier[solver.frontierCursor]
  if (!frontierNodeId) {
    solver.frontier = solver.nextFrontier
    solver.frontierCursor = 0
    solver.nextFrontier = []
    solver.activeExpandDegree = null
    return true
  }

  solver.lastExpansion = null
  const neighbors = solver.adjacencyByNodeId.get(frontierNodeId)
  if (neighbors) {
    for (const neighborId of neighbors) {
      if (solver.currentDiscoveredDepthByNodeId.has(neighborId)) continue

      solver.currentDiscoveredDepthByNodeId.set(neighborId, nextDegree)
      const edgeKey = solver.getEdgeKey(frontierNodeId, neighborId)
      const prevDegree = solver.currentDiscoveredDepthByEdgeKey.get(edgeKey)
      if (prevDegree === undefined || nextDegree < prevDegree) {
        solver.currentDiscoveredDepthByEdgeKey.set(edgeKey, nextDegree)
      }

      const { portIds, includesCrammed } = getPortIdsBetweenNodes({
        solver,
        nodeIdA: frontierNodeId,
        nodeIdB: neighborId,
        activeCrammedPortPointIds: solver.currentUsedCrammedPortPointIds,
      })

      if (portIds.length === 0) continue
      for (const portId of portIds) {
        solver.discoveredPortIdsByDegree.get(nextDegree)?.add(portId)
      }

      solver.lastExpansion = {
        degree: nextDegree,
        fromNodeId: frontierNodeId,
        toNodeId: neighborId as CapacityMeshNodeId,
        usedCrammed: includesCrammed,
      }
      solver.nextFrontier.push(neighborId as CapacityMeshNodeId)
    }
  }

  solver.frontierCursor += 1
  return false
}
