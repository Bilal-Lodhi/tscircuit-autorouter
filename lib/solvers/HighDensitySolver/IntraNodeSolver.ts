import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getMinDistBetweenEnteringPoints } from "lib/utils/getMinDistBetweenEnteringPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { SingleHighDensityRouteSolver } from "./SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type ConnectionPoint = { x: number; y: number; z: number }

const pointKey = (point: ConnectionPoint) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const dedupeConnectionPoints = (points: ConnectionPoint[]) => {
  const seen = new Set<string>()
  const deduped: ConnectionPoint[] = []

  for (const point of points) {
    const key = pointKey(point)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(point)
  }

  return deduped
}

export class IntraNodeRouteSolver extends BaseSolver {
  override getSolverName(): string {
    return "IntraNodeRouteSolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  unsolvedConnections: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }[]

  totalConnections: number
  solvedRoutes: HighDensityIntraNodeRoute[]
  failedSubSolvers: SingleHighDensityRouteSolver[]
  hyperParameters: Partial<HighDensityHyperParameters>
  minDistBetweenEnteringPoints: number
  viaDiameter: number
  traceWidth: number

  activeSubSolver: SingleHighDensityRouteSolver | null = null
  connMap?: ConnectivityMap

  // Legacy compat
  get failedSolvers() {
    return this.failedSubSolvers
  }

  // Legacy compat
  get activeSolver() {
    return this.activeSubSolver
  }

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
  }) {
    const { nodeWithPortPoints, colorMap } = params
    super()
    this.nodeWithPortPoints = nodeWithPortPoints
    this.colorMap = colorMap ?? {}
    this.solvedRoutes = []
    this.hyperParameters = params.hyperParameters ?? {}
    this.failedSubSolvers = []
    this.connMap = params.connMap
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.traceWidth = params.traceWidth ?? 0.15
    const unsolvedConnectionsMap: Map<string, ConnectionPoint[]> = new Map()
    for (const { connectionName, x, y, z } of nodeWithPortPoints.portPoints) {
      unsolvedConnectionsMap.set(connectionName, [
        ...(unsolvedConnectionsMap.get(connectionName) ?? []),
        { x, y, z: z ?? 0 },
      ])
    }
    this.unsolvedConnections = Array.from(
      unsolvedConnectionsMap.entries().map(([connectionName, points]) => ({
        connectionName,
        points: dedupeConnectionPoints(points),
      })),
    )

    if (this.hyperParameters.SHUFFLE_SEED) {
      this.unsolvedConnections = cloneAndShuffleArray(
        this.unsolvedConnections,
        this.hyperParameters.SHUFFLE_SEED ?? 0,
      )

      // Shuffle the starting and ending points of each connection (some
      // algorithms are biased towards the start or end of a trace)
      this.unsolvedConnections = this.unsolvedConnections.map(
        ({ points, ...rest }, i) => ({
          ...rest,
          points: cloneAndShuffleArray(
            points,
            i * 7117 + (this.hyperParameters.SHUFFLE_SEED ?? 0),
          ),
        }),
      )
    }

    this.totalConnections = this.unsolvedConnections.length
    this.MAX_ITERATIONS = 1_000 * this.totalConnections ** 1.5

    this.minDistBetweenEnteringPoints = getMinDistBetweenEnteringPoints(
      this.nodeWithPortPoints,
    )

    // const {
    //   numEntryExitLayerChanges,
    //   numSameLayerCrossings,
    //   numTransitionPairCrossings,
    //   numTransitions,
    // } = getIntraNodeCrossings(this.nodeWithPortPoints)

    // if (this.nodeWithPortPoints.portPoints.length === 4) {

    // }

    // if (
    //   numSameLayerCrossings === 0 &&
    //   numTransitions === 0 &&
    //   numEntryExitLayerChanges === 0
    // ) {
    //   this.handleSimpleNoCrossingsCase()
    // }
  }

  // handleSimpleNoCrossingsCase() {
  //   // TODO check to make sure there are no crossings due to trace width
  //   this.solved = true
  //   this.solvedRoutes = this.unsolvedConnections.map(
  //     ({ connectionName, points }) => ({
  //       connectionName,
  //       route: points,
  //       traceThickness: 0.1, // TODO load from hyperParameters
  //       viaDiameter: 0.3,
  //       vias: [],
  //     }),
  //   )
  //   this.unsolvedConnections = []
  // }

  computeProgress() {
    return (
      (this.solvedRoutes.length + (this.activeSubSolver?.progress || 0)) /
      this.totalConnections
    )
  }

  private getSingleRouteSolverOpts(unsolvedConnection: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }) {
    const { connectionName, points } = unsolvedConnection
    return {
      connectionName,
      minDistBetweenEnteringPoints: this.minDistBetweenEnteringPoints,
      bounds: getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints),
      A: { x: points[0].x, y: points[0].y, z: points[0].z },
      B: {
        x: points[points.length - 1].x,
        y: points[points.length - 1].y,
        z: points[points.length - 1].z,
      },
      obstacleRoutes: this.connMap
        ? this.solvedRoutes.filter(
            (sr) =>
              !this.connMap!.areIdsConnected(sr.connectionName, connectionName),
          )
        : this.solvedRoutes,
      futureConnections: this.unsolvedConnections,
      layerCount: this.nodeWithPortPoints.portPoints.reduce(
        (max, p) => Math.max(max, (p.z ?? 0) + 1),
        2,
      ),
      hyperParameters: this.hyperParameters,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceThickness: this.traceWidth,
    }
  }

  private trySolveSamePointLayerChange(unsolvedConnection: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }) {
    const opts = this.getSingleRouteSolverOpts(unsolvedConnection)
    const obstacleChecker =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
    const { A, B } = opts
    const viaPoint = { x: A.x, y: A.y }

    if (!isEndpointViaSafe(obstacleChecker, viaPoint, A, B)) {
      return false
    }

    const route = [
      { x: A.x, y: A.y, z: A.z },
      { ...viaPoint, z: A.z },
      { ...viaPoint, z: B.z },
      { x: B.x, y: B.y, z: B.z },
    ].filter(
      (pt, idx, arr) =>
        idx === 0 ||
        Math.abs(pt.x - arr[idx - 1].x) > 1e-6 ||
        Math.abs(pt.y - arr[idx - 1].y) > 1e-6 ||
        pt.z !== arr[idx - 1].z,
    )

    this.solvedRoutes.push({
      connectionName: unsolvedConnection.connectionName,
      traceThickness: this.traceWidth,
      viaDiameter: this.viaDiameter,
      route,
      vias: [{ x: viaPoint.x, y: viaPoint.y }],
    })
    return true
  }

  private queueExtraBranchesForMultiPointConnection(unsolvedConnection: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }) {
    const [origin, ...extraPoints] = dedupeConnectionPoints(
      unsolvedConnection.points,
    )

    if (!origin || extraPoints.length <= 1) return false

    for (const point of extraPoints) {
      this.unsolvedConnections.push({
        connectionName: unsolvedConnection.connectionName,
        points: [origin, point],
      })
    }

    return true
  }

  private getPureOverlapError() {
    const overlappingGapTarget =
      this.hyperParameters.MINIMUM_FINAL_ACCEPTANCE_GAP ?? 0
    const segments = this.solvedRoutes.flatMap(getRouteSameLayerSegments)
    const vias = this.solvedRoutes.flatMap(getRouteVias)

    for (let i = 0; i < segments.length; i++) {
      const left = segments[i]!
      for (let j = i + 1; j < segments.length; j++) {
        const right = segments[j]!
        if (left.z !== right.z) continue
        if (
          this.connMap?.areIdsConnected(left.connectionName, right.connectionName)
        ) {
          continue
        }

        const gap = getCopperGapBetweenSegments(left, right)
        if (gap < overlappingGapTarget) {
          return [
            `Pure overlap between traces in ${this.nodeWithPortPoints.capacityMeshNodeId}`,
            `${left.connectionName} vs ${right.connectionName}`,
            `gap=${gap.toFixed(6)}`,
          ].join(" ")
        }
      }
    }

    for (const via of vias) {
      for (const segment of segments) {
        if (
          this.connMap?.areIdsConnected(via.connectionName, segment.connectionName)
        ) {
          continue
        }

        const gap = getCopperGapBetweenViaAndSegment(via, segment)
        if (gap < overlappingGapTarget) {
          return [
            `Pure overlap between via and trace in ${this.nodeWithPortPoints.capacityMeshNodeId}`,
            `${via.connectionName} vs ${segment.connectionName}`,
            `gap=${gap.toFixed(6)}`,
          ].join(" ")
        }
      }
    }

    for (let i = 0; i < vias.length; i++) {
      const left = vias[i]!
      for (let j = i + 1; j < vias.length; j++) {
        const right = vias[j]!
        if (
          this.connMap?.areIdsConnected(left.connectionName, right.connectionName)
        ) {
          continue
        }

        const gap = getCopperGapBetweenVias(left, right)
        if (gap < overlappingGapTarget) {
          return [
            `Pure overlap between vias in ${this.nodeWithPortPoints.capacityMeshNodeId}`,
            `${left.connectionName} vs ${right.connectionName}`,
            `gap=${gap.toFixed(6)}`,
          ].join(" ")
        }
      }
    }

    return null
  }

  private getIllegalSameLayerCrossingError() {
    const bounds = getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints)
    const sameLayerRoutes = this.solvedRoutes
      .map((route) => ({
        connectionName: route.connectionName,
        start: route.route[0]!,
        end: route.route[route.route.length - 1]!,
      }))
      .filter(({ start, end }) => start.z === end.z)

    for (let i = 0; i < sameLayerRoutes.length; i++) {
      const left = sameLayerRoutes[i]!
      const leftA = getPerimeterCoordinate(left.start, bounds)
      const leftB = getPerimeterCoordinate(left.end, bounds)
      const leftMin = Math.min(leftA, leftB)
      const leftMax = Math.max(leftA, leftB)

      for (let j = i + 1; j < sameLayerRoutes.length; j++) {
        const right = sameLayerRoutes[j]!
        if (left.start.z !== right.start.z) continue
        if (
          this.connMap?.areIdsConnected(left.connectionName, right.connectionName)
        ) {
          continue
        }

        const rightA = getPerimeterCoordinate(right.start, bounds)
        const rightB = getPerimeterCoordinate(right.end, bounds)
        const rightMin = Math.min(rightA, rightB)
        const rightMax = Math.max(rightA, rightB)

        if (
          arePerimeterCoordsCoincident(leftMin, rightMin) ||
          arePerimeterCoordsCoincident(leftMin, rightMax) ||
          arePerimeterCoordsCoincident(leftMax, rightMin) ||
          arePerimeterCoordsCoincident(leftMax, rightMax)
        ) {
          continue
        }

        const interleaves =
          (leftMin < rightMin &&
            rightMin < leftMax &&
            leftMax < rightMax) ||
          (rightMin < leftMin &&
            leftMin < rightMax &&
            rightMax < leftMax)

        if (interleaves) {
          return [
            `Illegal same-layer crossing in ${this.nodeWithPortPoints.capacityMeshNodeId}`,
            `${left.connectionName} vs ${right.connectionName}`,
          ].join(" ")
        }
      }
    }

    return null
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      this.progress = this.computeProgress()
      if (this.activeSubSolver.solved) {
        this.solvedRoutes.push(this.activeSubSolver.solvedPath!)
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.failedSubSolvers.push(this.activeSubSolver)
        this.activeSubSolver = null
        this.error = this.failedSubSolvers.map((s) => s.error).join("\n")
        this.failed = true
      }
      return
    }

    const unsolvedConnection = this.unsolvedConnections.pop()
    this.progress = this.computeProgress()
    if (!unsolvedConnection) {
      if (this.failedSubSolvers.length > 0) {
        this.solved = false
        return
      }

      const overlapError = this.getPureOverlapError()
      if (overlapError) {
        this.failed = true
        this.error = overlapError
        return
      }

      const sameLayerCrossingError = this.getIllegalSameLayerCrossingError()
      if (sameLayerCrossingError) {
        this.failed = true
        this.error = sameLayerCrossingError
        return
      }

      this.solved = true
      return
    }
    if (unsolvedConnection.points.length === 1) {
      return
    }
    if (unsolvedConnection.points.length > 2) {
      if (this.queueExtraBranchesForMultiPointConnection(unsolvedConnection)) {
        return
      }
    }
    if (unsolvedConnection.points.length === 2) {
      const [A, B] = unsolvedConnection.points
      const sameX = Math.abs(A.x - B.x) < 1e-6
      const sameY = Math.abs(A.y - B.y) < 1e-6

      if (sameX && sameY && A.z === B.z) {
        return
      }

      // Fast-path: if the points share the same x/y but differ in layer,
      // prefer a pure via or a nearby obstacle-free via before invoking
      // the heavier search-based solvers. This keeps the degenerate case
      // fast, but avoids blindly routing through the node center.
      if (sameX && sameY && A.z !== B.z) {
        if (this.trySolveSamePointLayerChange(unsolvedConnection)) return
      }
    }
    this.activeSubSolver =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
        this.getSingleRouteSolverOpts(unsolvedConnection),
      )
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw node bounds
    // graphics.rects!.push({
    //   center: {
    //     x: this.nodeWithPortPoints.center.x,
    //     y: this.nodeWithPortPoints.center.y,
    //   },
    //   width: this.nodeWithPortPoints.width,
    //   height: this.nodeWithPortPoints.height,
    //   stroke: "gray",
    //   fill: "transparent",
    // })

    // Visualize input nodeWithPortPoints
    for (const pt of this.nodeWithPortPoints.portPoints) {
      graphics.points!.push({
        x: pt.x,
        y: pt.y,
        label: [pt.connectionName, `layer: ${pt.z}`].join("\n"),
        color: this.colorMap[pt.connectionName] ?? "blue",
      })
    }

    // Visualize solvedRoutes
    for (
      let routeIndex = 0;
      routeIndex < this.solvedRoutes.length;
      routeIndex++
    ) {
      const route = this.solvedRoutes[routeIndex]
      if (route.route.length > 0) {
        const routeColor = this.colorMap[route.connectionName] ?? "blue"

        // Draw route segments between points
        for (let i = 0; i < route.route.length - 1; i++) {
          const p1 = route.route[i]
          const p2 = route.route[i + 1]

          graphics.lines!.push({
            points: [p1, p2],
            strokeColor:
              p1.z === 0
                ? safeTransparentize(routeColor, 0.2)
                : safeTransparentize(routeColor, 0.8),
            layer: `route-layer-${p1.z}`,
            step: routeIndex,
            strokeWidth: route.traceThickness,
          })
        }

        // Draw vias
        for (const via of route.vias) {
          graphics.circles!.push({
            center: { x: via.x, y: via.y },
            radius: route.viaDiameter / 2,
            fill: safeTransparentize(routeColor, 0.5),
            layer: "via",
            step: routeIndex,
          })
        }
      }
    }

    // Draw border around the node
    const bounds = getBoundsFromNodeWithPortPoints(this.nodeWithPortPoints)
    const { minX, minY, maxX, maxY } = bounds

    // Draw the four sides of the border with thin red lines
    graphics.lines!.push({
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    return graphics
  }
}

type SameLayerSegment = {
  connectionName: string
  traceThickness: number
  z: number
  A: { x: number; y: number; z: number }
  B: { x: number; y: number; z: number }
}

type RouteVia = {
  connectionName: string
  viaDiameter: number
  x: number
  y: number
}

const getRouteSameLayerSegments = (route: HighDensityIntraNodeRoute) => {
  const segments: SameLayerSegment[] = []

  for (let i = 0; i < route.route.length - 1; i++) {
    const A = route.route[i]!
    const B = route.route[i + 1]!
    if (A.z !== B.z) continue
    segments.push({
      connectionName: route.connectionName,
      traceThickness: route.traceThickness,
      z: A.z,
      A,
      B,
    })
  }

  return segments
}

const getRouteVias = (route: HighDensityIntraNodeRoute) =>
  route.vias.map(
    (via) =>
      ({
        connectionName: route.connectionName,
        viaDiameter: route.viaDiameter,
        x: via.x,
        y: via.y,
      }) satisfies RouteVia,
  )

const getSegmentToSegmentCenterlineDistance = (
  left: SameLayerSegment,
  right: SameLayerSegment,
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

const getCopperGapBetweenSegments = (
  left: SameLayerSegment,
  right: SameLayerSegment,
) =>
  getSegmentToSegmentCenterlineDistance(left, right) -
  (left.traceThickness + right.traceThickness) / 2

const getCopperGapBetweenViaAndSegment = (
  via: RouteVia,
  segment: SameLayerSegment,
) =>
  pointToSegmentDistance(via, segment.A, segment.B) -
  (via.viaDiameter + segment.traceThickness) / 2

const getCopperGapBetweenVias = (left: RouteVia, right: RouteVia) =>
  distance(left, right) - (left.viaDiameter + right.viaDiameter) / 2

const getPerimeterCoordinate = (
  point: { x: number; y: number },
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
) => {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const eps = 1e-6

  if (Math.abs(point.y - bounds.maxY) < eps) {
    return point.x - bounds.minX
  }
  if (Math.abs(point.x - bounds.maxX) < eps) {
    return width + (bounds.maxY - point.y)
  }
  if (Math.abs(point.y - bounds.minY) < eps) {
    return width + height + (bounds.maxX - point.x)
  }
  if (Math.abs(point.x - bounds.minX) < eps) {
    return 2 * width + height + (point.y - bounds.minY)
  }

  const distTop = Math.abs(point.y - bounds.maxY)
  const distRight = Math.abs(point.x - bounds.maxX)
  const distBottom = Math.abs(point.y - bounds.minY)
  const distLeft = Math.abs(point.x - bounds.minX)
  const minDist = Math.min(distTop, distRight, distBottom, distLeft)

  if (minDist === distTop) {
    return Math.max(0, Math.min(width, point.x - bounds.minX))
  }
  if (minDist === distRight) {
    return width + Math.max(0, Math.min(height, bounds.maxY - point.y))
  }
  if (minDist === distBottom) {
    return width + height + Math.max(0, Math.min(width, bounds.maxX - point.x))
  }
  return (
    2 * width +
    height +
    Math.max(0, Math.min(height, point.y - bounds.minY))
  )
}

const arePerimeterCoordsCoincident = (
  left: number,
  right: number,
  eps = 1e-6,
) => Math.abs(left - right) < eps

const isEndpointViaSafe = (
  obstacleChecker: SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  viaPoint: { x: number; y: number },
  A: { x: number; y: number; z: number },
  B: { x: number; y: number; z: number },
) => {
  const viaNode = {
    x: viaPoint.x,
    y: viaPoint.y,
    z: A.z,
    parent: {
      x: A.x,
      y: A.y,
      z: A.z,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    },
    g: 0,
    h: 0,
    f: 0,
  }

  if (
    obstacleChecker.isNodeTooCloseToObstacle(
      viaNode,
      obstacleChecker.viaDiameter / 2 + obstacleChecker.obstacleMargin / 2,
      true,
    )
  ) {
    return false
  }

  if (obstacleChecker.isNodeTooCloseToEdge(viaNode, true)) {
    return false
  }

  return true
}
