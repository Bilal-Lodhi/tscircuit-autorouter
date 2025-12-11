import { SimpleRouteJson } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { mapZToLayerName } from "./mapZToLayerName"
import { getNamedPortPoints } from "./getNamedPortPoints"

export function createSrjFromNodeWithPortPoints(
  node: NodeWithPortPoints,
): SimpleRouteJson {
  const { center, width, height, portPoints } = node
  const namedPortPoints = getNamedPortPoints(portPoints)

  // Group port points by connection name
  const connectionGroups = new Map<string, typeof namedPortPoints>()
  for (const portPoint of namedPortPoints) {
    if (!connectionGroups.has(portPoint.connectionName)) {
      connectionGroups.set(portPoint.connectionName, [])
    }
    connectionGroups.get(portPoint.connectionName)!.push(portPoint)
  }

  // Create connections from grouped port points
  const connections = Array.from(connectionGroups.entries()).map(
    ([connectionName, points]) => ({
      name: connectionName,
      pointsToConnect: points.map((point) => ({
        x: point.x,
        y: point.y,
        layer: mapZToLayerName(point.z, node.availableZ?.length ?? 2),
      })),
    }),
  )

  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [], // NodeWithPortPoints has no obstacles
    connections,
    bounds: {
      minX: center.x - width / 2,
      maxX: center.x + width / 2,
      minY: center.y - height / 2,
      maxY: center.y + height / 2,
    },
  }
}
