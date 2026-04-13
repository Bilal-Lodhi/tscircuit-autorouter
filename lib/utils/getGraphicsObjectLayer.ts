import type { ConnectionPoint, Obstacle } from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export const getGraphicsLayerFromLayerNames = (
  layerNames: readonly string[],
  layerCount: number,
) =>
  `z${layerNames.map((layerName) => mapLayerNameToZ(layerName, layerCount)).join(",")}`

export const getGraphicsLayerForConnectionPoint = (
  point: ConnectionPoint,
  layerCount: number,
) => getGraphicsLayerFromLayerNames(getConnectionPointLayers(point), layerCount)

export const getGraphicsLayerForObstacle = (
  obstacle: Obstacle,
  layerCount: number,
) => getGraphicsLayerFromLayerNames(obstacle.layers, layerCount)
