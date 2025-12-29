import { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  buildSegmentsFromPairs,
  calculateSegmentCrossingMetrics,
} from "./segmentCrossingMetrics"
import { PortPointCollection } from "lib/types/capacity-port-point-types"

type PointPointsWithConnectionZLayer = PortPointCollection & {
  z: number
}

const getNodeBounds = (node: NodeWithPortPoints) => ({
  left: node.center.x - node.width / 2,
  right: node.center.x + node.width / 2,
  bottom: node.center.y - node.height / 2,
  top: node.center.y + node.height / 2,
})

export const getIntraNodeCrossings = (node: NodeWithPortPoints) => {
  const bounds = getNodeBounds(node)
  let pointPairs: PointPointsWithConnectionZLayer[] = []

  const transitionPairPoints: PortPointCollection[] = []

  for (const A of node.portPoints) {
    if (pointPairs.some((p) => p.connectionName === A.connectionName)) {
      continue
    }
    if (
      transitionPairPoints.some((p) => p.connectionName === A.connectionName)
    ) {
      continue
    }
    const pointPair: PointPointsWithConnectionZLayer = {
      connectionName: A.connectionName,
      z: A.z,
      points: [{ x: A.x, y: A.y, z: A.z }],
    }
    for (const B of node.portPoints) {
      if (A.connectionName !== B.connectionName) continue
      if (A.x === B.x && A.y === B.y) continue
      pointPair.points.push({ x: B.x, y: B.y, z: B.z })
    }
    if (pointPair.points.some((p) => p.z !== pointPair.z)) {
      transitionPairPoints.push(pointPair)
      continue
    }
    pointPairs.push(pointPair)
  }

  // TODO maybe these should be returned as "number of non-crossing connections"
  pointPairs = pointPairs.filter((p) => p.points.length > 1)

  const segments = [
    ...buildSegmentsFromPairs(pointPairs),
    ...buildSegmentsFromPairs(transitionPairPoints),
  ]
  const crossingMetrics = calculateSegmentCrossingMetrics(segments, {
    bounds,
  })

  return {
    numSameLayerCrossings: crossingMetrics.numSameLayerCrossings,
    numEntryExitLayerChanges: transitionPairPoints.length,
    numTransitionPairCrossings: crossingMetrics.numTransitionPairCrossings,
    numCollinearConnectionIntersections:
      crossingMetrics.numCollinearConnectionIntersections,
  }
}
