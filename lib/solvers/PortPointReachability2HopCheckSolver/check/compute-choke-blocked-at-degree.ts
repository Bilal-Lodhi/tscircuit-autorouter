import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { isPortTouchingObstacle } from "./is-port-touching-obstacle"

/** Returns true when all discovered ports at degree 2 are obstacle-touching. */
export const computeChokeBlockedAtDegree = ({
  solver,
  degree,
}: {
  solver: PortPointReachability2HopCheckSolver
  degree: 2
}): boolean => {
  const portIds = solver.discoveredPortIdsByDegree.get(degree)
  if (!portIds || portIds.size === 0) return false

  for (const portId of portIds) {
    if (!isPortTouchingObstacle({ solver, portId })) return false
  }

  return true
}
