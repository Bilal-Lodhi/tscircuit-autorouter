import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

export class SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost extends SingleHighDensityRouteSolver {
  FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = 2
  FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR = 1
  FUTURE_CONNECTION_PROXIMITY_VD = 10
  MISALIGNED_DIST_PENALTY_FACTOR = 5
  VIA_PENALTY_FACTOR_2 = 1
  FLIP_TRACE_ALIGNMENT_DIRECTION = false

  constructor(
    opts: ConstructorParameters<typeof SingleHighDensityRouteSolver>[0],
  ) {
    super(opts)
    for (const key in opts.hyperParameters) {
      // @ts-ignore
      this[key] = opts.hyperParameters[key]
    }

    // Ratio of available space determines via penalty
    const viasThatCanFitHorz = this.boundsSize.width / this.viaDiameter
    // Avoid division by zero when there are no routes
    const routeCount = Math.max(1, this.numRoutes)
    this.VIA_PENALTY_FACTOR =
      0.3 * (viasThatCanFitHorz / routeCount) * this.VIA_PENALTY_FACTOR_2
  }

  getClosestFutureConnectionPoint(node: Node) {
    let minDist = Infinity
    let closestPoint = null

    for (const futureConnection of this.futureConnections) {
      for (const point of futureConnection.points) {
        const dist =
          distance(node, point) +
          (node.z !== point.z ? this.viaPenaltyDistance : 0)
        if (dist < minDist) {
          minDist = dist
          closestPoint = point
        }
      }
    }

    return closestPoint
  }

  /**
   * Rapidly approaches 0 as the goal distance approaches 0
   */
  diminishCloseToGoal(node: Node) {
    const goalDist = distance(node, this.B)
    return 1 - Math.exp((-goalDist / this.straightLineDistance) * 5)
  }

  getFutureConnectionPenalty(node: Node, isVia: boolean) {
    let futureConnectionPenalty = 0
    const closestFuturePoint = this.getClosestFutureConnectionPoint(node)
    const goalDist = distance(node, this.B)
    if (closestFuturePoint) {
      const distToFuturePoint = distance(node, closestFuturePoint)
      if (goalDist <= distToFuturePoint) return 0
      const maxDist = this.viaDiameter * this.FUTURE_CONNECTION_PROXIMITY_VD
      const distRatio = distToFuturePoint / maxDist
      const maxPenalty = isVia
        ? this.straightLineDistance *
          this.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
        : this.straightLineDistance *
          this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
      futureConnectionPenalty = maxPenalty * Math.exp(-distRatio * 5)
    }
    return futureConnectionPenalty
  }

  computeH(node: Node) {
    const goalDist = distance(node, this.B) ** 1.6
    const goalDistRatio = goalDist / this.straightLineDistance

    // Base cost from original function
    const baseCost =
      goalDist + (node.z !== this.B.z ? this.viaPenaltyDistance : 0)

    return (
      baseCost +
      this.getFutureConnectionPenalty(node, node.z !== node.parent?.z)
    )
  }

  computeG(node: Node) {
    const dx = Math.abs(node.x - node.parent!.x)
    const dy = Math.abs(node.y - node.parent!.y)
    const dist = Math.sqrt(dx ** 2 + dy ** 2)

    // Even layers (0, 2, ...) prefer horizontal, odd layers (1, 3, ...) prefer vertical
    const isEvenLayer = node.z % 2 === 0
    const misalignedDist = !this.FLIP_TRACE_ALIGNMENT_DIRECTION
      ? isEvenLayer
        ? dy
        : dx
      : isEvenLayer
        ? dx
        : dy

    // Base cost from original function
    const baseCost =
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : this.viaPenaltyDistance) +
      dist +
      misalignedDist * this.MISALIGNED_DIST_PENALTY_FACTOR

    return (
      baseCost +
      this.getFutureConnectionPenalty(node, node.z !== node.parent?.z)
    )
  }

  /**
   * Keep the future-cost variant from accepting a route segment that runs
   * too close to an existing segment on the same layer from a different net.
   */
  override doesPathToParentIntersectObstacle(node: Node) {
    if (super.doesPathToParentIntersectObstacle(node)) {
      return true
    }
    const parent = node.parent
    if (!parent || !this.obstacleSegmentIndex) return false

    const clearance = this.traceThickness + this.obstacleMargin
    const minX = Math.min(node.x, parent.x) - clearance
    const maxX = Math.max(node.x, parent.x) + clearance
    const minY = Math.min(node.y, parent.y) - clearance
    const maxY = Math.max(node.y, parent.y) + clearance

    const nearbySegmentIds = this.obstacleSegmentIndex.search(
      minX,
      minY,
      maxX,
      maxY,
    )

    for (const segmentId of nearbySegmentIds) {
      const segment = this.obstacleSegments[segmentId]
      if (!segment || segment.connectedToCurrentConnection) continue
      if (segment.z !== node.z) continue

      const centerlineDistance = getSegmentToSegmentCenterlineDistance(
        { A: node, B: parent },
        segment,
      )
      if (centerlineDistance < (clearance/2)) {
        return true
      }
    }

    return false
  }
}

const getSegmentToSegmentCenterlineDistance = (
  left: { A: { x: number; y: number }; B: { x: number; y: number } },
  right: { A: { x: number; y: number }; B: { x: number; y: number } },
) => {
  if (doSegmentsIntersect(left.A, left.B, right.A, right.B)) {
    return 0
  }

  return Math.min(
    pointToSegmentDistance(left.A, right.A, right.B),
    pointToSegmentDistance(left.B, right.A, right.B),
    pointToSegmentDistance(right.A, left.A, left.B),
    pointToSegmentDistance(right.B, left.A, left.B),
  )
}
