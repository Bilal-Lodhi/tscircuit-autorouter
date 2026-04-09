import {
  distance,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

export type Point2D = { x: number; y: number }
export type Point3D = Point2D & { z: number; insideJumperPad?: boolean }

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export const getNodeBounds = (node: NodeWithPortPoints, margin = 0) => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

export const clampPointToNode = (
  point: Point3D,
  node: NodeWithPortPoints | null,
  padding = 0.04,
): Point3D => {
  if (!node) return point
  const bounds = getNodeBounds(node, -padding)
  return {
    ...point,
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  }
}

export const interpolatePointOnSegment = (
  start: Point3D,
  end: Point3D,
  distanceAlong: number,
): Point3D => {
  const segmentLength = distance(start, end)
  if (segmentLength < 1e-6) return { ...start }
  const t = clamp(distanceAlong / segmentLength, 0, 1)
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z,
  }
}

export const dedupeSequentialRoutePoints = (
  route: Point3D[],
  tolerance = 1e-4,
) => {
  const deduped: Point3D[] = []
  for (const point of route) {
    const previousPoint = deduped[deduped.length - 1]
    if (
      previousPoint &&
      Math.abs(previousPoint.x - point.x) <= tolerance &&
      Math.abs(previousPoint.y - point.y) <= tolerance &&
      previousPoint.z === point.z
    ) {
      continue
    }
    deduped.push(point)
  }
  return deduped
}

export const getSegmentNormal = (start: Point2D, end: Point2D) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const segmentLength = Math.hypot(dx, dy)
  if (segmentLength < 1e-6) {
    return null
  }
  return {
    x: -dy / segmentLength,
    y: dx / segmentLength,
    length: segmentLength,
  }
}

export {
  distance,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
}
