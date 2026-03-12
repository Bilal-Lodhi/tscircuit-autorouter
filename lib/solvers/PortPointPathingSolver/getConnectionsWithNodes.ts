import { distance } from "@tscircuit/math-utils"
import type { CapacityMeshNodeId, SimpleRouteJson } from "../../types"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "./PortPointPathingSolver"

export interface GetConnectionsWithNodesResult {
  /** Connections with their node assignments (NOT shuffled) */
  unshuffledConnectionsWithResults: ConnectionPathResult[]
  /** Map from connection name to goal node IDs */
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>
}

const getDistanceToNodeBox = (
  point: { x: number; y: number },
  node: InputNodeWithPortPoints,
) => {
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2

  const dx = point.x < minX ? minX - point.x : point.x > maxX ? point.x - maxX : 0
  const dy = point.y < minY ? minY - point.y : point.y > maxY ? point.y - maxY : 0

  return Math.sqrt(dx * dx + dy * dy)
}

const getNodeForConnectionPoint = (
  point: { x: number; y: number },
  nodesWithTargets: InputNodeWithPortPoints[],
) => {
  let bestNode = nodesWithTargets[0]
  let bestBoxDistance = Number.MAX_VALUE
  let bestCenterDistance = Number.MAX_VALUE

  for (const node of nodesWithTargets) {
    const boxDistance = getDistanceToNodeBox(point, node)
    const centerDistance = Math.sqrt(
      (node.center.x - point.x) ** 2 + (node.center.y - point.y) ** 2,
    )

    if (
      boxDistance < bestBoxDistance ||
      (boxDistance === bestBoxDistance && centerDistance < bestCenterDistance)
    ) {
      bestNode = node
      bestBoxDistance = boxDistance
      bestCenterDistance = centerDistance
    }
  }

  return bestNode
}

/**
 * Computes the connections with their node assignments and goal node IDs.
 * This returns the unshuffled connections - shuffling should be done separately
 * with the SHUFFLE_SEED parameter.
 */
export function getConnectionsWithNodes(
  simpleRouteJson: SimpleRouteJson,
  inputNodes: InputNodeWithPortPoints[],
): GetConnectionsWithNodesResult {
  const connectionsWithResults: ConnectionPathResult[] = []
  const nodesWithTargets = inputNodes.filter((n) => n._containsTarget)
  const connectionNameToGoalNodeIds = new Map<string, CapacityMeshNodeId[]>()

  for (const connection of simpleRouteJson.connections) {
    const nodesForConnection: InputNodeWithPortPoints[] = []

    for (const point of connection.pointsToConnect) {
      const closestNode = getNodeForConnectionPoint(point, nodesWithTargets)
      nodesForConnection.push(closestNode)
    }

    if (nodesForConnection.length < 2) {
      throw new Error(
        `Not enough nodes for connection "${connection.name}", only ${nodesForConnection.length} found`,
      )
    }

    connectionNameToGoalNodeIds.set(
      connection.name,
      nodesForConnection.map((n) => n.capacityMeshNodeId),
    )

    connectionsWithResults.push({
      connection,
      nodeIds: [
        nodesForConnection[0].capacityMeshNodeId,
        nodesForConnection[nodesForConnection.length - 1].capacityMeshNodeId,
      ],
      straightLineDistance: distance(
        nodesForConnection[0].center,
        nodesForConnection[nodesForConnection.length - 1].center,
      ),
    })
  }

  return {
    unshuffledConnectionsWithResults: connectionsWithResults,
    connectionNameToGoalNodeIds,
  }
}
