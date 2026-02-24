import { TypedRegionPort } from "./HopCheckSolver"

export const areAllRegionPortsBlocked = (regionPorts: TypedRegionPort[]) => {
  for (const port of regionPorts) {
    const neighborRegions = [port.region1, port.region2]
    for (const neighborRegion of neighborRegions) {
      if (!neighborRegion.d._containsObstacle) {
        return false
      }
    }
  }
  return true
}
