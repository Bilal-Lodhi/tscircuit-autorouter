import { distance } from "@tscircuit/math-utils"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { CapacityMeshNodeId } from "lib/types"

/** Returns the closest capacity-mesh node to a point. */
export const findClosestNodeId = ({
  point,
  preferredNodes,
  inputNodes,
}: {
  point: { x: number; y: number }
  preferredNodes: InputNodeWithPortPoints[]
  inputNodes: InputNodeWithPortPoints[]
}): CapacityMeshNodeId | null => {
  const nodes = preferredNodes.length > 0 ? preferredNodes : inputNodes
  if (nodes.length === 0) return null

  let bestNode = nodes[0]
  let bestDist = distance(point, bestNode.center)

  for (let i = 1; i < nodes.length; i++) {
    const d = distance(point, nodes[i].center)
    if (d < bestDist) {
      bestDist = d
      bestNode = nodes[i]
    }
  }

  return bestNode.capacityMeshNodeId
}
