import { SegmentPoint } from "lib/solvers/UnravelSolver/types"
import {
  buildSegmentsFromPairs,
  calculateSegmentCrossingMetrics,
} from "./segmentCrossingMetrics"
import { PortPointCollection } from "lib/types"

type PointPair = PortPointCollection & {
  z: number
}

export const getIntraNodeCrossingsFromSegmentPoints = (
  segmentPoints: SegmentPoint[],
) => {
  // Count the number of crossings
  let numEntryExitLayerChanges = 0

  const connectionGroups = new Map<string, PointPair>()

  for (const point of segmentPoints) {
    if (!connectionGroups.has(point.connectionName)) {
      connectionGroups.set(point.connectionName, {
        connectionName: point.connectionName,
        z: point.z,
        points: [point],
      })
      continue
    }
    connectionGroups.get(point.connectionName)!.points.push(point)
  }

  const sameLayerPointPairs: PortPointCollection[] = []
  const transitionPairPoints: PortPointCollection[] = []

  for (const pair of connectionGroups.values()) {
    if (pair.points.length < 2) continue
    if (pair.points.some((p) => p.z !== pair.z)) {
      transitionPairPoints.push(pair)
      numEntryExitLayerChanges++
      continue
    }
    sameLayerPointPairs.push(pair)
  }

  const segmentsForMetrics = [
    ...buildSegmentsFromPairs(sameLayerPointPairs),
    ...buildSegmentsFromPairs(transitionPairPoints),
  ]
  const crossingMetrics = calculateSegmentCrossingMetrics(segmentsForMetrics, {
    bounds: { left: 0, right: 0, top: 0, bottom: 0 },
  })
  const numTransitionCrossings =
    crossingMetrics.numTransitionPairCrossings +
    crossingMetrics.numTransitionMixedCrossings

  return {
    numSameLayerCrossings: crossingMetrics.numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionCrossings,
  }
}
