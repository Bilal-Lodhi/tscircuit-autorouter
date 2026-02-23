import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"

/** Stores current obstacle result and advances cursor. */
export const handleFinalizeObstaclePhase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  solver.results.push({
    obstacleIndex:
      solver.currentObstacleSrjIndex ?? solver.currentObstacleIndex,
    obstacle: solver.currentObstacle!,
    anchorNodeId: solver.currentAnchorNodeId,
    discoveredDepthByNodeId: new Map(solver.currentDiscoveredDepthByNodeId),
    discoveredDepthByEdgeKey: new Map(solver.currentDiscoveredDepthByEdgeKey),
    chokeBlockedAtDegree2: solver.currentChokeBlockedAtDegree2,
    usedCrammedPortPointIds: new Set(solver.currentUsedCrammedPortPointIds),
  })

  solver.currentObstacleIndex++
  solver.currentObstacle = null
  solver.currentObstacleSrjIndex = null
  solver.currentAnchorNodeId = null
  solver.resetCurrentObstacleTraversalState()
  solver.phase =
    solver.currentObstacleIndex >= solver.srj.obstacles.length
      ? "done"
      : "select_obstacle"
}
