import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"

/** Advances from target association to BFS init. */
export const handleAssociateTargetsPhase = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  solver.phase = "bfs_degree_0"
}
