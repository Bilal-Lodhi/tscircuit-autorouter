import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { tryResolveChokeWithCrammedPortsForCurrentObstacle } from "../check/try-resolve-choke-with-crammed-ports-for-current-obstacle"

/** Attempts crammed-port fallback; marks failure if still blocked. */
export const handleRetryWithCrammedPhase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  const resolved = tryResolveChokeWithCrammedPortsForCurrentObstacle(solver)
  if (!resolved) {
    solver.error = `Obstacle ${solver.currentObstacleSrjIndex ?? solver.currentObstacleIndex} failed 2-hop reachability check: all degree-2 ports are blocked by obstacle-touching nodes`
    solver.failed = true
    return
  }

  solver.phase = "finalize_obstacle"
}
