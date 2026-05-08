import { getBoundFromCenteredRect, type Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"

export type RoutingAdjacencyReason = "strict_border" | "overlap" | "small_gap"

const OVERLAP_EPSILON = 1e-6
const MAX_ROUTING_ADJACENCY_GAP = 0.2

const getNodeBounds = (node: CapacityMeshNode): Bounds =>
  getBoundFromCenteredRect({
    center: node.center,
    width: node.width,
    height: node.height,
  })

const getOverlapDimensions = (bounds1: Bounds, bounds2: Bounds) => {
  return {
    x:
      Math.min(bounds1.maxX, bounds2.maxX) -
      Math.max(bounds1.minX, bounds2.minX),
    y:
      Math.min(bounds1.maxY, bounds2.maxY) -
      Math.max(bounds1.minY, bounds2.minY),
  }
}

const getAxisGap = (aMin: number, aMax: number, bMin: number, bMax: number) =>
  Math.max(0, Math.max(aMin - bMax, bMin - aMax))

const getAdaptiveGapThreshold = (
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
) =>
  Math.min(
    MAX_ROUTING_ADJACENCY_GAP,
    0.5 * Math.min(node1.width, node1.height, node2.width, node2.height),
  )

const getRequiredOrthogonalOverlap = (
  overlapAxisLength1: number,
  overlapAxisLength2: number,
) => Math.min(0.05, 0.5 * Math.min(overlapAxisLength1, overlapAxisLength2))

export const getRoutingAdjacencyReason = (
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
): RoutingAdjacencyReason | null => {
  if (!node1.availableZ.some((z) => node2.availableZ.includes(z))) {
    return null
  }

  if (areNodesBordering(node1, node2)) {
    return "strict_border"
  }

  const bounds1 = getNodeBounds(node1)
  const bounds2 = getNodeBounds(node2)
  const { x: xOverlap, y: yOverlap } = getOverlapDimensions(bounds1, bounds2)

  if (xOverlap > OVERLAP_EPSILON && yOverlap > OVERLAP_EPSILON) {
    return "overlap"
  }

  const gapThreshold = getAdaptiveGapThreshold(node1, node2)
  const requiredXOverlap = getRequiredOrthogonalOverlap(
    node1.width,
    node2.width,
  )
  const requiredYOverlap = getRequiredOrthogonalOverlap(
    node1.height,
    node2.height,
  )
  const xGap = getAxisGap(
    bounds1.minX,
    bounds1.maxX,
    bounds2.minX,
    bounds2.maxX,
  )
  const yGap = getAxisGap(
    bounds1.minY,
    bounds1.maxY,
    bounds2.minY,
    bounds2.maxY,
  )

  if (
    xGap > OVERLAP_EPSILON &&
    xGap <= gapThreshold &&
    yOverlap >= requiredYOverlap
  ) {
    return "small_gap"
  }

  if (
    yGap > OVERLAP_EPSILON &&
    yGap <= gapThreshold &&
    xOverlap >= requiredXOverlap
  ) {
    return "small_gap"
  }

  return null
}

export const getMaxRoutingAdjacencyGap = () => MAX_ROUTING_ADJACENCY_GAP
