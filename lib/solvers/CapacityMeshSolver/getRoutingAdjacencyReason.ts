import type { CapacityMeshNode } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"

export type RoutingAdjacencyReason = "strict_border" | "overlap" | "small_gap"

type Bounds = {
  left: number
  right: number
  top: number
  bottom: number
}

const OVERLAP_EPSILON = 1e-6
const MAX_ROUTING_ADJACENCY_GAP = 0.2

const getBounds = (node: CapacityMeshNode): Bounds => ({
  left: node.center.x - node.width / 2,
  right: node.center.x + node.width / 2,
  top: node.center.y - node.height / 2,
  bottom: node.center.y + node.height / 2,
})

const getPositiveOverlap = (
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
) => Math.min(aMax, bMax) - Math.max(aMin, bMin)

const getPositiveGap = (
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
) => Math.max(0, Math.max(aMin - bMax, bMin - aMax))

const getAdaptiveGapThreshold = (
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
) =>
  Math.min(
    MAX_ROUTING_ADJACENCY_GAP,
    0.5 *
      Math.min(node1.width, node1.height, node2.width, node2.height),
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

  const bounds1 = getBounds(node1)
  const bounds2 = getBounds(node2)
  const xOverlap = getPositiveOverlap(
    bounds1.left,
    bounds1.right,
    bounds2.left,
    bounds2.right,
  )
  const yOverlap = getPositiveOverlap(
    bounds1.top,
    bounds1.bottom,
    bounds2.top,
    bounds2.bottom,
  )

  if (xOverlap > OVERLAP_EPSILON && yOverlap > OVERLAP_EPSILON) {
    return "overlap"
  }

  const gapThreshold = getAdaptiveGapThreshold(node1, node2)
  const requiredXOverlap = getRequiredOrthogonalOverlap(node1.width, node2.width)
  const requiredYOverlap = getRequiredOrthogonalOverlap(
    node1.height,
    node2.height,
  )
  const xGap = getPositiveGap(
    bounds1.left,
    bounds1.right,
    bounds2.left,
    bounds2.right,
  )
  const yGap = getPositiveGap(
    bounds1.top,
    bounds1.bottom,
    bounds2.top,
    bounds2.bottom,
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
