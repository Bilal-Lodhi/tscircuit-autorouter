import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { ConnectionPoint } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { sharedZLayers } from "./sharedZLayers"
import type { RegionHg } from "./types"

const REGION_MATCH_EPS = 1e-8

/** Checks whether a connection endpoint lies inside a region on at least one shared layer. */
export function checkIfConnectionPointIsInRegion(params: {
  point: ConnectionPoint
  region: RegionHg
  layerCount: number
}): boolean {
  if (pointToBoxDistance(params.point, params.region.d) <= REGION_MATCH_EPS) {
    const layers =
      "layers" in params.point ? params.point.layers : [params.point.layer]
    const intLayers = layers.map((layer) => {
      return mapLayerNameToZ(layer, params.layerCount)
    })
    const sharedLayers = sharedZLayers(intLayers, params.region.d.availableZ)
    if (sharedLayers.length > 0) {
      return true
    }
  }
  return false
}
