import type { CapacityMeshNodeId } from "lib/types"

/** Builds a stable map key for an undirected edge. */
export const getEdgeKey = (
  nodeIdA: CapacityMeshNodeId,
  nodeIdB: CapacityMeshNodeId,
): string => {
  return nodeIdA < nodeIdB ? `${nodeIdA}__${nodeIdB}` : `${nodeIdB}__${nodeIdA}`
}
