import { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import {
  buildSegmentsFromPairs,
  calculateSegmentCrossingMetrics,
} from "./segmentCrossingMetrics"
import { PortPointCollection } from "lib/types"
import { Port } from "@tscircuit/core"

type PointPair = PortPointCollection & {
  z: number
}

/**
 * Get the number of crossings between segments on the same node
 */
export const getIntraNodeCrossingsFromSegments = (
  segments: SegmentWithAssignedPoints[],
): {
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionCrossings: number
} => {
  const portPoints = segments.flatMap((seg) => seg.assignedPoints!)

  const pointPairMap = new Map<string, PointPair>()
  for (const { connectionName, point } of portPoints) {
    if (!pointPairMap.has(connectionName)) {
      pointPairMap.set(connectionName, {
        connectionName,
        z: point.z,
        points: [point],
      })
      continue
    }
    pointPairMap.get(connectionName)!.points.push(point)
  }

  const sameLayerPointPairs: PortPointCollection[] = []
  const transitionPairPoints: PortPointCollection[] = []
  let numEntryExitLayerChanges = 0

  for (const pair of pointPairMap.values()) {
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
  const crossingMetrics = calculateSegmentCrossingMetrics(segmentsForMetrics)
  const numTransitionCrossings =
    crossingMetrics.numTransitionPairCrossings +
    crossingMetrics.numTransitionMixedCrossings

  return {
    numSameLayerCrossings: crossingMetrics.numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionCrossings,
  }
}
