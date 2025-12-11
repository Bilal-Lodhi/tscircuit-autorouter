import { NodeWithPortPoints } from "lib/types/high-density-types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getNamedPortPoints } from "./getNamedPortPoints"
export const generateColorMapFromNodeWithPortPoints = (
  nodeWithPortPoints: NodeWithPortPoints,
  connMap?: ConnectivityMap,
) => {
  const colorMap: Record<string, string> = {}
  getNamedPortPoints(nodeWithPortPoints.portPoints).forEach((portPoint, i) => {
    colorMap[portPoint.connectionName] =
      `hsl(${(i * 360) / nodeWithPortPoints.portPoints.length}, 100%, 50%)`
  })
  return colorMap
}
