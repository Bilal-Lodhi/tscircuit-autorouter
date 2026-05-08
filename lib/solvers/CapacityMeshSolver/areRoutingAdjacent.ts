import type { CapacityMeshNode } from "lib/types"
import {
  getMaxRoutingAdjacencyGap,
  getRoutingAdjacencyReason,
} from "./getRoutingAdjacencyReason"

export const areRoutingAdjacent = (
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
): boolean => getRoutingAdjacencyReason(node1, node2) !== null

export { getMaxRoutingAdjacencyGap }
