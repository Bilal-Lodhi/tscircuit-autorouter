import { TypedRegionPort } from "./types"

/**
 * Checks if all ports of a region are blocked by obstacles. A port is considered blocked if at least one of its neighboring regions contains an obstacle.
 */
export const areAllRegionPortsBlocked = (regionPorts: TypedRegionPort[]) => {
  if (regionPorts.length === 0) return false

  let result = true
  for (const port of regionPorts) {
    const neighborRegions = [port.region1, port.region2]
    let isPortBlocked = false
    for (const neighborRegion of neighborRegions) {
      if (neighborRegion.d._containsObstacle) {
        isPortBlocked = true
        break
      }
    }
    result = result && isPortBlocked
  }
  return result
}
