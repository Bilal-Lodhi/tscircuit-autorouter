import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { findClosestNodeId } from "../nodes/find-closest-node-id"

/** Selects the current obstacle and anchor node. */
export const handleSelectObstaclePhase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  solver.currentObstacleSrjIndex =
    solver.orderedObstacleIndices[solver.currentObstacleIndex] ??
    solver.currentObstacleIndex
  solver.currentObstacle = solver.srj.obstacles[solver.currentObstacleSrjIndex]
  solver.currentAnchorNodeId = findClosestNodeId({
    point: solver.currentObstacle.center,
    preferredNodes: solver.inputNodes.filter((n) => n._containsObstacle),
    inputNodes: solver.inputNodes,
  })
  solver.resetCurrentObstacleTraversalState()
  solver.phase = "associate_targets"
}
