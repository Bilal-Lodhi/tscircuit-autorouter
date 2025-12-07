import { distance } from "@tscircuit/math-utils"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
} from "lib/types"
import { isMultiLayerConnectionPoint } from "./connection-point-utils"

const nodeContainsPoint = (
  node: CapacityMeshNode,
  point: { x: number; y: number },
) => {
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  return (
    Math.abs(node.center.x - point.x) <= halfWidth &&
    Math.abs(node.center.y - point.y) <= halfHeight
  )
}

export const buildLayerFlexibleNeighborMap = ({
  connections,
  nodes,
}: {
  connections: SimpleRouteConnection[]
  nodes: CapacityMeshNode[]
}): Map<CapacityMeshNodeId, CapacityMeshNodeId[]> => {
  const neighborMap = new Map<CapacityMeshNodeId, CapacityMeshNodeId[]>()
  const nodesByConnection = new Map<string, CapacityMeshNode[]>()

  for (const node of nodes) {
    if (!node._targetConnectionName) continue
    if (!nodesByConnection.has(node._targetConnectionName)) {
      nodesByConnection.set(node._targetConnectionName, [])
    }
    nodesByConnection.get(node._targetConnectionName)!.push(node)
  }

  for (const connection of connections) {
    const targetNodesForConnection =
      nodesByConnection.get(connection.name) ?? []

    for (const point of connection.pointsToConnect) {
      if (!isMultiLayerConnectionPoint(point)) continue
      const overlappingTargetNodes = targetNodesForConnection.filter((node) =>
        nodeContainsPoint(node, point),
      )

      if (overlappingTargetNodes.length < 2) continue

      // Connect overlapping target nodes together so we can switch layers at the start
      for (const node of overlappingTargetNodes) {
        const neighbors = neighborMap.get(node.capacityMeshNodeId) ?? []
        for (const otherNode of overlappingTargetNodes) {
          if (otherNode.capacityMeshNodeId === node.capacityMeshNodeId) continue
          if (neighbors.includes(otherNode.capacityMeshNodeId)) continue

          // Prefer nodes that are actually the same physical location to avoid long jumps
          if (distance(node.center, otherNode.center) > node.width) continue

          neighbors.push(otherNode.capacityMeshNodeId)
        }
        if (neighbors.length > 0) {
          neighborMap.set(node.capacityMeshNodeId, neighbors)
        }
      }
    }
  }

  return neighborMap
}
