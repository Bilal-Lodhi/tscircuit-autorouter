import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import type { CapacityMeshNodeId } from "lib/types"

/** Collects regular and selected crammed ports on an edge. */
export const getPortIdsBetweenNodes = ({
  solver,
  nodeIdA,
  nodeIdB,
  activeCrammedPortPointIds,
}: {
  solver: PortPointReachability2HopCheckSolver
  nodeIdA: CapacityMeshNodeId
  nodeIdB: CapacityMeshNodeId
  activeCrammedPortPointIds?: Set<string>
}): { portIds: string[]; includesCrammed: boolean } => {
  const edgeKey = solver.getEdgeKey(nodeIdA, nodeIdB)
  const normalPortIds = solver.normalPortIdsByEdgeKey.get(edgeKey) ?? []
  const crammedPortIds =
    solver.crammedPortPointsByEdgeKey
      .get(edgeKey)
      ?.filter((pp) => activeCrammedPortPointIds?.has(pp.segmentPortPointId))
      .map((pp) => pp.segmentPortPointId) ?? []

  return {
    portIds: [...normalPortIds, ...crammedPortIds],
    includesCrammed: crammedPortIds.length > 0,
  }
}
