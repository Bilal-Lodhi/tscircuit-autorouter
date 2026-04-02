import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import {
  FORCE_VECTOR_DISPLAY_MULTIPLIER,
  ForceDirectedImprovementSession,
  type ForceImproveResult,
} from "./force-improve"
import { simplifyRoutes } from "./simplify"

type ForceImproveSampleEntry = {
  node: NodeWithPortPoints
  routeIndexes: number[]
}

const DEFAULT_NODE_MARGIN = 0.2
const DEFAULT_TOTAL_STEPS = 100
const DEFAULT_TARGET_SEGMENTS = 10
const MOVED_POINT_EPSILON = 1e-5
const DIRECTION_ARROW_BASE_LENGTH = 0.18
const DIRECTION_ARROW_MAX_EXTRA_LENGTH = FORCE_VECTOR_DISPLAY_MULTIPLIER * 0.03
const DIRECTION_ARROW_RING_RADIUS = 0.04

const roundToTwoDecimals = (value: number) => Number(value.toFixed(2))

const clampValue = (value: number, minValue: number, maxValue: number) =>
  Math.max(minValue, Math.min(maxValue, value))

const getNodeBounds = (node: NodeWithPortPoints, margin = 0) => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

const isPointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
  margin = 0,
) => {
  const bounds = getNodeBounds(node, margin)
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

const findNodeIndexForRoute = (
  route: HighDensityRoute,
  nodes: NodeWithPortPoints[],
  margin: number,
): number => {
  const routePoints = route.route.map(({ x, y }) => ({ x, y }))
  const viaPoints = route.vias.map(({ x, y }) => ({ x, y }))
  const points = [...routePoints, ...viaPoints]

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (points.every((point) => isPointInsideNode(point, node, margin))) {
      return i
    }
  }

  return -1
}

const cloneRoute = (route: HighDensityRoute): HighDensityRoute => ({
  ...route,
  route: route.route.map((point) => ({ ...point })),
  vias: route.vias.map((via) => ({ ...via })),
  jumpers: route.jumpers?.map((jumper) => ({
    ...jumper,
    start: { ...jumper.start },
    end: { ...jumper.end },
  })),
})

const reverseRoute = (route: HighDensityRoute): HighDensityRoute => ({
  ...route,
  route: route.route.toReversed(),
  vias: route.vias.toReversed(),
  jumpers: route.jumpers?.toReversed().map((jumper) => ({
    ...jumper,
    start: { ...jumper.end },
    end: { ...jumper.start },
  })),
})

const getPointDistance = (
  left: { x: number; y: number },
  right: { x: number; y: number },
) => Math.hypot(left.x - right.x, left.y - right.y)

const getPortPointsByConnectionName = (
  nodeWithPortPoints: NodeWithPortPoints,
) => {
  const portPointsByConnection = new Map<
    string,
    typeof nodeWithPortPoints.portPoints
  >()

  for (const portPoint of nodeWithPortPoints.portPoints) {
    const existingPortPoints =
      portPointsByConnection.get(portPoint.connectionName) ?? []
    existingPortPoints.push(portPoint)
    portPointsByConnection.set(portPoint.connectionName, existingPortPoints)
  }

  return portPointsByConnection
}

const reattachRouteToResolvedPortPoints = (
  route: HighDensityRoute,
  connectionPortPoints:
    | [
        NodeWithPortPoints["portPoints"][number],
        NodeWithPortPoints["portPoints"][number],
      ]
    | undefined,
): HighDensityRoute | null => {
  if (!connectionPortPoints || route.route.length === 0) {
    return null
  }

  const firstPoint = route.route[0]
  const lastPoint = route.route.at(-1)
  if (!firstPoint || !lastPoint) {
    return null
  }

  const [startPortPoint, endPortPoint] = connectionPortPoints
  const forwardDistance =
    getPointDistance(firstPoint, startPortPoint) +
    getPointDistance(lastPoint, endPortPoint)
  const reverseDistance =
    getPointDistance(firstPoint, endPortPoint) +
    getPointDistance(lastPoint, startPortPoint)

  const normalizedRoute =
    reverseDistance < forwardDistance ? reverseRoute(route) : cloneRoute(route)
  const normalizedFirstPoint = normalizedRoute.route[0]
  const normalizedLastPoint = normalizedRoute.route.at(-1)

  if (!normalizedFirstPoint || !normalizedLastPoint) {
    return null
  }

  normalizedRoute.route[0] = {
    ...normalizedFirstPoint,
    x: startPortPoint.x,
    y: startPortPoint.y,
    z: startPortPoint.z,
  }
  normalizedRoute.route[normalizedRoute.route.length - 1] = {
    ...normalizedLastPoint,
    x: endPortPoint.x,
    y: endPortPoint.y,
    z: endPortPoint.z,
  }

  return normalizedRoute
}

const reattachRoutesToNode = (
  routes: HighDensityRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
): HighDensityRoute[] | null => {
  const portPointsByConnection =
    getPortPointsByConnectionName(nodeWithPortPoints)
  const reattachedRoutes = new Array<HighDensityRoute>(routes.length)

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) {
      return null
    }

    const connectionPortPoints = portPointsByConnection.get(
      route.connectionName,
    )
    if (!connectionPortPoints || connectionPortPoints.length !== 2) {
      return null
    }

    const reattachedRoute = reattachRouteToResolvedPortPoints(route, [
      connectionPortPoints[0]!,
      connectionPortPoints[1]!,
    ])
    if (!reattachedRoute) {
      return null
    }

    reattachedRoutes[routeIndex] = reattachedRoute
  }

  return reattachedRoutes
}

const getDrcCompatibleNodeBounds = (nodeWithPortPoints: NodeWithPortPoints) => {
  const rawMinX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
  const rawMaxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
  const rawMinY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
  const rawMaxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2

  return {
    minX: Math.min(rawMinX, roundToTwoDecimals(rawMinX)),
    maxX: Math.max(rawMaxX, roundToTwoDecimals(rawMaxX)),
    minY: Math.min(rawMinY, roundToTwoDecimals(rawMinY)),
    maxY: Math.max(rawMaxY, roundToTwoDecimals(rawMaxY)),
  }
}

const clampRoutesToNodeBounds = (
  nodeWithPortPoints: NodeWithPortPoints,
  routes: HighDensityRoute[],
) => {
  const bounds = getDrcCompatibleNodeBounds(nodeWithPortPoints)

  return routes.map((route) => {
    const clampedRoute = cloneRoute(route)

    clampedRoute.route = clampedRoute.route.map((point) => ({
      ...point,
      x: clampValue(point.x, bounds.minX, bounds.maxX),
      y: clampValue(point.y, bounds.minY, bounds.maxY),
    }))
    clampedRoute.vias = clampedRoute.vias.map((via) => ({
      x: clampValue(via.x, bounds.minX, bounds.maxX),
      y: clampValue(via.y, bounds.minY, bounds.maxY),
    }))

    return clampedRoute
  })
}

export class Pipeline4ForceImproveSolver extends BaseSolver {
  readonly totalSteps: number
  readonly nodeMargin: number
  readonly targetSegmentCount: number
  readonly sampleEntries: ForceImproveSampleEntry[]
  readonly originalHdRoutes: HighDensityRoute[]
  readonly originalNodeWithPortPoints: NodeWithPortPoints[]
  readonly colorMap: Record<string, string>

  improvedRoutesByIndex = new Map<number, HighDensityRoute>()
  activeSampleIndex = 0
  activeSession: ForceDirectedImprovementSession | null = null
  visualizedSampleEntry: ForceImproveSampleEntry | null = null
  initialVisualizationResult: ForceImproveResult | null = null
  latestVisualizationResult: ForceImproveResult | null = null

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    totalSteps?: number
    nodeMargin?: number
    targetSegmentCount?: number
    colorMap?: Record<string, string>
  }) {
    super()
    this.totalSteps = params.totalSteps ?? DEFAULT_TOTAL_STEPS
    this.nodeMargin = params.nodeMargin ?? DEFAULT_NODE_MARGIN
    this.targetSegmentCount =
      params.targetSegmentCount ?? DEFAULT_TARGET_SEGMENTS
    this.originalHdRoutes = params.hdRoutes
    this.originalNodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}

    const routeIndexesByNode = new Map<number, number[]>()
    for (let i = 0; i < params.hdRoutes.length; i++) {
      const nodeIndex = findNodeIndexForRoute(
        params.hdRoutes[i],
        params.nodeWithPortPoints,
        this.nodeMargin,
      )
      if (nodeIndex === -1) continue
      const routeIndexes = routeIndexesByNode.get(nodeIndex) ?? []
      routeIndexes.push(i)
      routeIndexesByNode.set(nodeIndex, routeIndexes)
    }

    this.sampleEntries = Array.from(routeIndexesByNode.entries()).map(
      ([nodeIndex, routeIndexes]) => ({
        node: params.nodeWithPortPoints[nodeIndex]!,
        routeIndexes,
      }),
    )

    this.MAX_ITERATIONS = Math.max(
      this.sampleEntries.length * (this.totalSteps + 2),
      100_000,
    )
    this.stats = {
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: 0,
      improvedRouteCount: 0,
      totalSteps: this.totalSteps,
    }
  }

  override getSolverName(): string {
    return "Pipeline4ForceImproveSolver"
  }

  override getConstructorParams() {
    return [
      {
        nodeWithPortPoints: this.originalNodeWithPortPoints,
        hdRoutes: this.originalHdRoutes,
        totalSteps: this.totalSteps,
        nodeMargin: this.nodeMargin,
        targetSegmentCount: this.targetSegmentCount,
        colorMap: this.colorMap,
      },
    ] as const
  }

  computeProgress() {
    if (this.sampleEntries.length === 0) return 1

    const completedNodes = this.activeSampleIndex
    const inFlightProgress = this.activeSession
      ? this.activeSession.stepsCompleted / Math.max(this.totalSteps, 1)
      : 0

    return Math.min(
      (completedNodes + inFlightProgress) / this.sampleEntries.length,
      1,
    )
  }

  override _step() {
    const sampleEntry = this.sampleEntries[this.activeSampleIndex]

    if (!sampleEntry) {
      this.solved = true
      return
    }

    if (!this.activeSession) {
      const sampleRoutes = sampleEntry.routeIndexes.map((routeIndex) =>
        cloneRoute(this.originalHdRoutes[routeIndex]!),
      )
      const reattachedSampleRoutes =
        reattachRoutesToNode(sampleRoutes, sampleEntry.node) ?? sampleRoutes
      const preprocessedSampleRoutes = simplifyRoutes(
        clampRoutesToNodeBounds(sampleEntry.node, reattachedSampleRoutes),
        this.targetSegmentCount,
      )

      this.activeSession = new ForceDirectedImprovementSession(
        {
          center: sampleEntry.node.center,
          width: sampleEntry.node.width,
          height: sampleEntry.node.height,
        },
        preprocessedSampleRoutes,
        this.totalSteps,
      )
      this.visualizedSampleEntry = sampleEntry
      const initialResult = this.activeSession.getCurrentResult()
      this.initialVisualizationResult = initialResult
      this.latestVisualizationResult = initialResult
    }

    const result = this.activeSession.advance({ includeForceVectors: true })
    this.latestVisualizationResult = result

    this.stats = {
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: this.activeSampleIndex,
      improvedRouteCount: this.improvedRoutesByIndex.size,
      totalSteps: this.totalSteps,
      currentNodeId: sampleEntry.node.capacityMeshNodeId,
      currentStep: result.stepsCompleted,
    }

    if (!this.activeSession.finalized) {
      return
    }

    for (let i = 0; i < sampleEntry.routeIndexes.length; i++) {
      const routeIndex = sampleEntry.routeIndexes[i]
      const improvedRoute = result.routes[i]
      this.improvedRoutesByIndex.set(
        routeIndex,
        improvedRoute ?? this.originalHdRoutes[routeIndex]!,
      )
    }

    this.activeSampleIndex += 1
    this.activeSession = null
    this.stats = {
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: this.activeSampleIndex,
      improvedRouteCount: this.improvedRoutesByIndex.size,
      totalSteps: this.totalSteps,
    }

    if (this.activeSampleIndex >= this.sampleEntries.length) {
      this.solved = true
    }
  }

  getOutput(): HighDensityRoute[] {
    return this.originalHdRoutes.map(
      (route, index) => this.improvedRoutesByIndex.get(index) ?? route,
    )
  }

  override visualize(): GraphicsObject {
    const sampleEntry = this.visualizedSampleEntry
    const initialResult = this.initialVisualizationResult
    const currentResult = this.latestVisualizationResult

    if (!sampleEntry || !initialResult || !currentResult) {
      return {
        title: "Pipeline4 Force Improve",
        lines: [],
        points: [],
        circles: [],
      }
    }

    const lines: NonNullable<GraphicsObject["lines"]> = []
    const points: NonNullable<GraphicsObject["points"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []
    const rects: NonNullable<GraphicsObject["rects"]> = []
    const node = sampleEntry.node
    const left = node.center.x - node.width / 2
    const right = node.center.x + node.width / 2
    const top = node.center.y - node.height / 2
    const bottom = node.center.y + node.height / 2

    for (const circuitNode of this.originalNodeWithPortPoints) {
      const isActiveNode =
        circuitNode.capacityMeshNodeId === node.capacityMeshNodeId

      rects.push({
        center: { ...circuitNode.center },
        width: circuitNode.width,
        height: circuitNode.height,
        fill: isActiveNode ? "rgba(37,99,235,0.08)" : "rgba(148,163,184,0.04)",
        stroke: isActiveNode ? "rgba(37,99,235,0.9)" : "rgba(148,163,184,0.45)",
        label: `${circuitNode.capacityMeshNodeId}${isActiveNode ? " active node" : " node"}`,
      })

      for (const portPoint of circuitNode.portPoints) {
        points.push({
          x: portPoint.x,
          y: portPoint.y,
          color: this.colorMap[portPoint.connectionName] ?? "#111827",
          label: `${portPoint.connectionName} port`,
        })
      }
    }

    lines.push(
      {
        points: [
          { x: left, y: top },
          { x: right, y: top },
        ],
        strokeColor: "rgba(37,99,235,0.9)",
        strokeDash: "6, 4",
        strokeWidth: 0.05,
        label: `${node.capacityMeshNodeId} active node border`,
      },
      {
        points: [
          { x: right, y: top },
          { x: right, y: bottom },
        ],
        strokeColor: "rgba(37,99,235,0.9)",
        strokeDash: "6, 4",
        strokeWidth: 0.05,
        label: `${node.capacityMeshNodeId} active node border`,
      },
      {
        points: [
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        strokeColor: "rgba(37,99,235,0.9)",
        strokeDash: "6, 4",
        strokeWidth: 0.05,
        label: `${node.capacityMeshNodeId} active node border`,
      },
      {
        points: [
          { x: left, y: bottom },
          { x: left, y: top },
        ],
        strokeColor: "rgba(37,99,235,0.9)",
        strokeDash: "6, 4",
        strokeWidth: 0.05,
        label: `${node.capacityMeshNodeId} active node border`,
      },
    )

    for (const route of initialResult.routes) {
      for (let i = 0; i < route.route.length - 1; i++) {
        const start = route.route[i]
        const end = route.route[i + 1]
        lines.push({
          points: [
            { x: start!.x, y: start!.y },
            { x: end!.x, y: end!.y },
          ],
          strokeColor: "rgba(107,114,128,0.7)",
          strokeWidth: Math.max(route.traceThickness * 0.8, 0.03),
          strokeDash: "4, 4",
          label: `${route.connectionName} initial route`,
        })
      }
    }

    const displayRoutes = this.getOutput().map((route) =>
      structuredClone(route),
    )

    for (let i = 0; i < sampleEntry.routeIndexes.length; i += 1) {
      const routeIndex = sampleEntry.routeIndexes[i]
      const activeRoute = currentResult.routes[i]
      if (!activeRoute) continue
      displayRoutes[routeIndex] = activeRoute
    }

    let movedPointCount = 0

    for (
      let routeIndex = 0;
      routeIndex < displayRoutes.length;
      routeIndex += 1
    ) {
      const route = displayRoutes[routeIndex]!
      const activeRouteIndex = sampleEntry.routeIndexes.indexOf(routeIndex)
      const initialRoute =
        activeRouteIndex === -1 ? null : initialResult.routes[activeRouteIndex]
      const isActiveRoute = activeRouteIndex !== -1
      const strokeColor = this.colorMap[route.connectionName] ?? "#22c55e"

      for (let i = 0; i < route.route.length - 1; i++) {
        const start = route.route[i]
        const end = route.route[i + 1]
        lines.push({
          points: [
            { x: start!.x, y: start!.y },
            { x: end!.x, y: end!.y },
          ],
          strokeColor,
          strokeWidth: route.traceThickness,
          label: isActiveRoute
            ? `${route.connectionName} current step`
            : `${route.connectionName} route`,
        })
      }
      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          stroke: strokeColor,
          fill: isActiveRoute ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.08)",
        })
      }

      if (!initialRoute) continue

      const sharedPointCount = Math.min(
        route.route.length,
        initialRoute.route.length,
      )
      for (let pointIndex = 0; pointIndex < sharedPointCount; pointIndex += 1) {
        const currentPoint = route.route[pointIndex]
        const initialPoint = initialRoute.route[pointIndex]
        if (!currentPoint || !initialPoint) continue

        const moveDistance = Math.hypot(
          currentPoint.x - initialPoint.x,
          currentPoint.y - initialPoint.y,
        )
        if (moveDistance <= MOVED_POINT_EPSILON) continue

        movedPointCount += 1
      }
    }

    for (const vector of currentResult.forceVectors) {
      const magnitude = Math.hypot(vector.dx, vector.dy)
      if (magnitude === 0) continue
      const directionScale = 1 / magnitude
      const displayLength = Math.min(
        DIRECTION_ARROW_BASE_LENGTH +
          magnitude * DIRECTION_ARROW_MAX_EXTRA_LENGTH,
        DIRECTION_ARROW_BASE_LENGTH * 2,
      )
      lines.push({
        points: [
          { x: vector.x, y: vector.y },
          {
            x: vector.x + vector.dx * directionScale * displayLength,
            y: vector.y + vector.dy * directionScale * displayLength,
          },
        ],
        strokeColor: "rgba(245,158,11,0.8)",
        strokeWidth: 0.04,
        label: `${vector.rootConnectionName} desired direction`,
      })
      circles.push({
        center: { x: vector.x, y: vector.y },
        radius: DIRECTION_ARROW_RING_RADIUS,
        stroke: "rgba(245,158,11,0.85)",
        fill: "rgba(245,158,11,0.02)",
      })
    }

    const displayedStep = Math.min(
      currentResult.stepsCompleted,
      this.totalSteps,
    )
    return {
      title: `Pipeline4 Force Improve: ${node.capacityMeshNodeId} step ${displayedStep}/${this.totalSteps} offset ${movedPointCount} pts`,
      lines,
      points,
      circles,
      rects,
    }
  }
}
