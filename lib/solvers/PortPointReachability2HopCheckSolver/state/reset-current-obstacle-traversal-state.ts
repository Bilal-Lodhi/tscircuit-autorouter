import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"

/** Clears traversal state before processing an obstacle. */
export const resetCurrentObstacleTraversalState = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  solver.currentDiscoveredDepthByNodeId = new Map()
  solver.currentDiscoveredDepthByEdgeKey = new Map()
  solver.discoveredPortIdsByDegree = new Map([
    [0, new Set()],
    [1, new Set()],
    [2, new Set()],
  ])
  solver.currentChokeBlockedAtDegree2 = false
  solver.frontier = []
  solver.frontierCursor = 0
  solver.nextFrontier = []
  solver.activeExpandDegree = null
  solver.currentUsedCrammedPortPointIds = new Set()
  solver.activeObstacleUsesCrammed = false
  solver.lastExpansion = null
}
