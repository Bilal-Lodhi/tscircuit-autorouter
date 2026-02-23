import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"

/** Seeds BFS frontier from the anchor node. */
export const handleBfsDegree0Phase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  if (solver.currentAnchorNodeId) {
    solver.currentDiscoveredDepthByNodeId.set(solver.currentAnchorNodeId, 0)
    solver.frontier = [solver.currentAnchorNodeId]
  } else {
    solver.frontier = []
  }

  solver.frontierCursor = 0
  solver.nextFrontier = []
  solver.activeExpandDegree = null
  solver.phase = "bfs_degree_1"
}
