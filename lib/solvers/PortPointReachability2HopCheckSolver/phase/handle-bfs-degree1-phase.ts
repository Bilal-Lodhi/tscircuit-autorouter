import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { expandOneDegreeIncremental } from "../bfs/expand-one-degree-incremental"

/** Runs incremental BFS for degree 1. */
export const handleBfsDegree1Phase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  const doneExpanding = expandOneDegreeIncremental({ solver, nextDegree: 1 })
  if (doneExpanding) {
    solver.phase = "bfs_degree_2"
  }
}
