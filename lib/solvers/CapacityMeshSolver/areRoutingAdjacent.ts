import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"

type NodeBounds = ReturnType<typeof getBoundFromCenteredRect>

const OVERLAP_EPSILON = 1e-6
export const MAX_ROUTING_ADJACENCY_GAP = 0.2

const getNodeBounds = (node: CapacityMeshNode): NodeBounds =>
  getBoundFromCenteredRect({
    center: node.center,
    width: node.width,
    height: node.height,
  })

const getOverlapDimensions = (bounds1: NodeBounds, bounds2: NodeBounds) => ({
  x:
    Math.min(bounds1.maxX, bounds2.maxX) - Math.max(bounds1.minX, bounds2.minX),
  y:
    Math.min(bounds1.maxY, bounds2.maxY) - Math.max(bounds1.minY, bounds2.minY),
})

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

export const areRoutingAdjacent = (
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
): boolean => {
  if (!node1.availableZ.some((z) => node2.availableZ.includes(z))) {
    return false
  }

  if (areNodesBordering(node1, node2)) {
    return true
  }

  const bounds1 = getNodeBounds(node1)
  const bounds2 = getNodeBounds(node2)
  const { x: xOverlap, y: yOverlap } = getOverlapDimensions(bounds1, bounds2)

  if (xOverlap > OVERLAP_EPSILON && yOverlap > OVERLAP_EPSILON) {
    return true
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
  if (
    xGap > OVERLAP_EPSILON &&
    xGap <= gapThreshold &&
    yOverlap >= requiredYOverlap
  ) {
    return true
  }

  const yGap = getAxisGap(
    bounds1.minY,
    bounds1.maxY,
    bounds2.minY,
    bounds2.maxY,
  )
  return (
    yGap > OVERLAP_EPSILON &&
    yGap <= gapThreshold &&
    xOverlap >= requiredXOverlap
  )
}
