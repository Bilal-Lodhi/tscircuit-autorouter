import { doSegmentsIntersect } from "@tscircuit/math-utils"
import {
  PortPointCollection,
  Segment,
} from "lib/types/capacity-port-point-types"

export type SegmentCrossingMetrics = {
  numSameLayerCrossings: number
  numTransitionPairCrossings: number
  numTransitionMixedCrossings: number
  numCollinearConnectionIntersections: number
}

type NodeSide = "left" | "right" | "top" | "bottom"

// Intersection calculation is only accurate to 0.00001 (0.01mm)
const intSpace = (a: number) => Math.round(a * 10000)

const toIntSpacePoint = (point: { x: number; y: number }) => ({
  x: intSpace(point.x),
  y: intSpace(point.y),
})

const getPointSide = (
  point: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
): NodeSide | null => {
  if (point.x === bounds.left) return "left"
  if (point.x === bounds.right) return "right"
  if (point.y === bounds.top) return "top"
  if (point.y === bounds.bottom) return "bottom"
  return null
}

export const buildSegmentsFromPairs = (
  pairs: PortPointCollection[],
): Segment[] => {
  const segments: Segment[] = []
  for (const pair of pairs) {
    if (pair.points.length < 2) continue
    for (let i = 0; i < pair.points.length - 1; i++) {
      const start = pair.points[i]
      const end = pair.points[i + 1]
      if (start.x === end.x && start.y === end.y && start.z === end.z) {
        continue
      }
      segments.push({
        connectionName: pair.connectionName,
        start,
        end,
      })
    }
  }
  return segments
}

export const calculateSegmentCrossingMetrics = (
  segments: Segment[],
  options?: {
    bounds?: { left: number; right: number; top: number; bottom: number }
  },
): SegmentCrossingMetrics => {
  const bounds = options?.bounds

  const sameLayerSegments = segments.filter(
    (segment) => segment.start.z === segment.end.z,
  )
  const transitionSegments = segments.filter(
    (segment) => segment.start.z !== segment.end.z,
  )

  let numSameLayerCrossings = 0
  let numTransitionPairCrossings = 0
  let numTransitionMixedCrossings = 0

  let numCollinearConnectionIntersections = 0

  for (let i = 0; i < sameLayerSegments.length; i++) {
    for (let j = i + 1; j < sameLayerSegments.length; j++) {
      const seg1 = sameLayerSegments[i]
      const seg2 = sameLayerSegments[j]
      if (
        seg1.connectionName !== seg2.connectionName &&
        doSegmentsIntersect(
          toIntSpacePoint(seg1.start),
          toIntSpacePoint(seg1.end),
          toIntSpacePoint(seg2.start),
          toIntSpacePoint(seg2.end),
        )
      ) {
        numSameLayerCrossings++
      }
    }
  }

  for (let i = 0; i < transitionSegments.length; i++) {
    for (let j = i + 1; j < transitionSegments.length; j++) {
      const seg1 = transitionSegments[i]
      const seg2 = transitionSegments[j]
      if (
        seg1.connectionName !== seg2.connectionName &&
        doSegmentsIntersect(
          toIntSpacePoint(seg1.start),
          toIntSpacePoint(seg1.end),
          toIntSpacePoint(seg2.start),
          toIntSpacePoint(seg2.end),
        )
      ) {
        numTransitionPairCrossings++
      }
    }
  }

  for (const transitionSegment of transitionSegments) {
    for (const sameLayerSegment of sameLayerSegments) {
      if (transitionSegment.connectionName === sameLayerSegment.connectionName)
        continue
      if (
        doSegmentsIntersect(
          toIntSpacePoint(transitionSegment.start),
          toIntSpacePoint(transitionSegment.end),
          toIntSpacePoint(sameLayerSegment.start),
          toIntSpacePoint(sameLayerSegment.end),
        )
      ) {
        numTransitionMixedCrossings++
      }
    }
  }

  if (bounds) {
    const collinearMap: Record<string, boolean> = {}
    for (const segment of sameLayerSegments) {
      const sideA = getPointSide(segment.start, bounds)
      const sideB = getPointSide(segment.end, bounds)
      const isCollinear = Boolean(sideA && sideB && sideA === sideB)
      if (!isCollinear) continue

      if (!(segment.connectionName in collinearMap)) {
        collinearMap[segment.connectionName] = false
      }

      for (const other of segments) {
        if (other.connectionName === segment.connectionName) continue
        if (
          doSegmentsIntersect(
            toIntSpacePoint(segment.start),
            toIntSpacePoint(segment.end),
            toIntSpacePoint(other.start),
            toIntSpacePoint(other.end),
          )
        ) {
          collinearMap[segment.connectionName] = true
          break
        }
      }
    }
    numCollinearConnectionIntersections =
      Object.values(collinearMap).filter(Boolean).length
  }

  return {
    numSameLayerCrossings,
    numTransitionPairCrossings,
    numTransitionMixedCrossings,
    numCollinearConnectionIntersections,
  }
}
