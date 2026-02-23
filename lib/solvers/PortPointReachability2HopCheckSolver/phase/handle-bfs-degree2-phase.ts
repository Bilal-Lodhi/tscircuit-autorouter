import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { expandOneDegreeIncremental } from "../bfs/expand-one-degree-incremental"
import { computeChokeBlockedAtDegree } from "../check/compute-choke-blocked-at-degree"

/** Runs degree-2 BFS and sets next phase by choke result. */
export const handleBfsDegree2Phase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  const doneExpanding = expandOneDegreeIncremental({ solver, nextDegree: 2 })
  if (!doneExpanding) return

  solver.currentChokeBlockedAtDegree2 = computeChokeBlockedAtDegree({
    solver,
    degree: 2,
  })
  solver.phase = solver.currentChokeBlockedAtDegree2
    ? "retry_with_crammed"
    : "finalize_obstacle"
}
