import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import {
  distance,
  doesSegmentIntersectRect,
  pointToBoxDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { Point, Point3 } from "@tscircuit/math-utils"
import type { PcbTraceError } from "circuit-json"
import { GraphicsObject } from "graphics-debug"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { Obstacle, SimpleRouteJson } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Point3D = Point3 & { insideJumperPad?: boolean }
type RoutePoint = HighDensityRoute["route"][number]
type RoutePointWithOptionalPort = RoutePoint & { pcb_port_id?: string }

type TraceSpacingIssue = {
  pcb_trace_id: string
  pcb_trace_error_id?: string
  message?: string
  center: Point
  pcb_port_ids?: string[]
}

type IssueContext = {
  issue: TraceSpacingIssue
  routeIndex: number
  routeLayer: string
  obstacle: Obstacle | null
  segmentIndex: number
  runStartSegIndex: number
  runEndSegIndex: number
  axis: "horizontal" | "vertical"
  directionOrder: [number, number]
  directionIndex: number
  shiftStep: number
  previousIssueCount: number
  previousIssueKeys: Set<string>
}

const SHIFT_INCREMENT_MM = 0.05
const MAX_SHIFT_STEPS = 40
const LOCAL_ROUTE_WINDOW_MARGIN_MM = 1.0

const cloneRoute = (route: HighDensityRoute): HighDensityRoute =>
  structuredClone(route)

function normalizeRoutesForTwoLayerCheck(
  routes: HighDensityRoute[],
): HighDensityRoute[] {
  return routes.map((route) => ({
    ...cloneRoute(route),
    route: route.route.map((point) => ({
      ...point,
      z: Math.max(0, Math.min(1, point.z)),
    })),
  }))
}

function rectBounds(rect: Obstacle) {
  return {
    minX: rect.center.x - rect.width / 2,
    maxX: rect.center.x + rect.width / 2,
    minY: rect.center.y - rect.height / 2,
    maxY: rect.center.y + rect.height / 2,
  }
}

function pointToRectDistance(point: Point, rect: Obstacle): number {
  return pointToBoxDistance(point, rect)
}

function expandObstacle(obstacle: Obstacle, margin: number): Obstacle {
  return {
    ...obstacle,
    width: obstacle.width + margin * 2,
    height: obstacle.height + margin * 2,
  }
}

function segmentIntersectsRect(a: Point, b: Point, rect: Obstacle): boolean {
  const rb = rectBounds(rect)
  return doesSegmentIntersectRect(a, b, rb)
}

function pointInsideRect(point: Point, rect: Obstacle): boolean {
  const rb = rectBounds(rect)
  return (
    point.x >= rb.minX &&
    point.x <= rb.maxX &&
    point.y >= rb.minY &&
    point.y <= rb.maxY
  )
}

function boundsIntersect(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  )
}

function normalizeTraceIssues(
  traceErrors: PcbTraceError[],
): TraceSpacingIssue[] {
  const issues: TraceSpacingIssue[] = []
  for (const error of traceErrors) {
    const pcbTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : null
    const center =
      error.center &&
      typeof error.center.x === "number" &&
      typeof error.center.y === "number"
        ? ({ x: error.center.x, y: error.center.y } as Point)
        : null
    if (!pcbTraceId || !center) continue
    issues.push({
      pcb_trace_id: pcbTraceId,
      center,
      message: error.message,
      pcb_trace_error_id:
        typeof error.pcb_trace_error_id === "string"
          ? error.pcb_trace_error_id
          : undefined,
      pcb_port_ids: Array.isArray(error.pcb_port_ids)
        ? error.pcb_port_ids.filter(
            (id): id is string => typeof id === "string",
          )
        : undefined,
    })
  }
  return issues
}

function hasPcbPortId(point: RoutePoint): point is RoutePointWithOptionalPort {
  return (
    "pcb_port_id" in point &&
    typeof (point as RoutePointWithOptionalPort).pcb_port_id === "string"
  )
}

function parseRouteIndexFromTraceId(pcbTraceId: string): number | null {
  const m = /^trace_(\d+)/.exec(pcbTraceId)
  if (!m) return null
  const idx = Number(m[1])
  return Number.isFinite(idx) ? idx : null
}

function routeLayerFromIssue(
  route: HighDensityRoute,
  issueCenter: Point,
  layerCount: number,
): string {
  let bestZ = route.route[0]?.z ?? 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < route.route.length - 1; i++) {
    const a = route.route[i]!
    const b = route.route[i + 1]!
    if (a.z !== b.z) continue
    const d = pointToSegmentDistance(issueCenter, a, b)
    if (d < bestDist) {
      bestDist = d
      bestZ = a.z
    }
  }
  return mapZToLayerName(bestZ, layerCount)
}

function recomputeViasFromRoute(
  route: HighDensityRoute,
): Array<{ x: number; y: number }> {
  const vias: Array<{ x: number; y: number }> = []
  const seen = new Set<string>()
  for (let i = 1; i < route.route.length; i++) {
    const prev = route.route[i - 1]!
    const curr = route.route[i]!
    if (
      prev.z !== curr.z &&
      Math.abs(prev.x - curr.x) < 0.01 &&
      Math.abs(prev.y - curr.y) < 0.01
    ) {
      const key = `${curr.x.toFixed(4)},${curr.y.toFixed(4)}`
      if (seen.has(key)) continue
      seen.add(key)
      vias.push({ x: curr.x, y: curr.y })
    }
  }
  return vias
}

function sameIssue(a: TraceSpacingIssue, b: TraceSpacingIssue): boolean {
  if (a.pcb_trace_id !== b.pcb_trace_id) return false
  if (a.pcb_trace_error_id && b.pcb_trace_error_id) {
    return a.pcb_trace_error_id === b.pcb_trace_error_id
  }
  if (distance(a.center, b.center) > 0.25) return false
  if (!a.pcb_port_ids || !b.pcb_port_ids) return true
  return a.pcb_port_ids.some((id) => b.pcb_port_ids!.includes(id))
}

function routeToGraphicsLines(
  route: HighDensityRoute,
  strokeColor: string,
  strokeWidth = route.traceThickness,
): NonNullable<GraphicsObject["lines"]> {
  const lines: NonNullable<GraphicsObject["lines"]> = []
  for (let i = 0; i < route.route.length - 1; i++) {
    const a = route.route[i]!
    const b = route.route[i + 1]!
    if (a.z !== b.z) continue
    lines.push({
      points: [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ],
      strokeColor,
      strokeWidth,
    })
  }
  return lines
}

export class TraceMarginDrcRepairSolver extends BaseSolver {
  override getSolverName(): string {
    return "TraceMarginDrcRepairSolver"
  }

  private originalHdRoutes: HighDensityRoute[]
  private hdRoutes: HighDensityRoute[]
  private unresolvedIssueKeys = new Set<string>()
  private currentIssueContext: IssueContext | null = null
  private currentCandidateRoute: HighDensityRoute | null = null
  private currentObstacleMarginRect: Obstacle | null = null
  private obstaclesByLayer = new Map<string, Obstacle[]>()
  private obstacleIndexByLayer = new Map<string, ObstacleSpatialHashIndex>()
  private cachedIssues: TraceSpacingIssue[] = []
  private latestIssueCount = 0

  constructor(
    private readonly input: {
      hdRoutes: HighDensityRoute[]
      srj: SimpleRouteJson
      minTraceWidth: number
      obstacleMargin: number
      colorMap?: Record<string, string>
    },
  ) {
    super()
    this.MAX_ITERATIONS = 2e6
    this.originalHdRoutes = input.hdRoutes.map(cloneRoute)
    this.hdRoutes = input.hdRoutes.map(cloneRoute)

    for (const obstacle of this.input.srj.obstacles) {
      for (const layer of obstacle.layers) {
        const existing = this.obstaclesByLayer.get(layer)
        if (existing) {
          existing.push(obstacle)
        } else {
          this.obstaclesByLayer.set(layer, [obstacle])
        }
      }
    }

    for (const [layer, obstacles] of this.obstaclesByLayer.entries()) {
      this.obstacleIndexByLayer.set(
        layer,
        new ObstacleSpatialHashIndex("flatbush", obstacles),
      )
    }
  }

  get repairedHdRoutes(): HighDensityRoute[] {
    return this.hdRoutes
  }

  private buildIssueKey(issue: TraceSpacingIssue): string {
    return `${issue.pcb_trace_error_id ?? "issue"}:${issue.pcb_trace_id}:${issue.center.x.toFixed(3)}:${issue.center.y.toFixed(3)}`
  }

  private runTraceSpacingCheck(
    hdRoutes: HighDensityRoute[],
  ): TraceSpacingIssue[] {
    const normalizedRoutes = normalizeRoutesForTwoLayerCheck(hdRoutes)
    const circuitJson = convertToCircuitJson(
      this.input.srj,
      normalizedRoutes,
      this.input.minTraceWidth,
      this.input.srj.minViaDiameter ?? 0.3,
    )
    const rawErrors = checkEachPcbTraceNonOverlapping(circuitJson, {
      minSpacing: this.input.obstacleMargin,
    })
    return normalizeTraceIssues(rawErrors)
  }

  private getCurrentIssues(): TraceSpacingIssue[] {
    const issues = this.runTraceSpacingCheck(this.hdRoutes).filter(
      (issue) => !this.unresolvedIssueKeys.has(this.buildIssueKey(issue)),
    )
    this.cachedIssues = issues
    this.latestIssueCount = issues.length
    return issues
  }

  private getRunBounds(
    route: HighDensityRoute,
    runStartSegIndex: number,
    runEndSegIndex: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (
      let pointIndex = runStartSegIndex;
      pointIndex <= runEndSegIndex + 1;
      pointIndex++
    ) {
      const p = route.route[pointIndex]!
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }

    return { minX, minY, maxX, maxY }
  }

  private isRouteNearBounds(
    route: HighDensityRoute,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): boolean {
    for (let i = 0; i < route.route.length - 1; i++) {
      const a = route.route[i]!
      const b = route.route[i + 1]!
      if (a.z !== b.z) continue
      const segmentBounds = {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      }
      if (boundsIntersect(segmentBounds, bounds)) return true
    }
    return false
  }

  private runLocalTraceSpacingCheck(
    hdRoutes: HighDensityRoute[],
    context: IssueContext,
    candidateRoute: HighDensityRoute,
  ): TraceSpacingIssue[] {
    const runBounds = this.getRunBounds(
      candidateRoute,
      context.runStartSegIndex,
      context.runEndSegIndex,
    )
    const routeWindow = {
      minX:
        runBounds.minX -
        candidateRoute.traceThickness -
        this.input.obstacleMargin -
        LOCAL_ROUTE_WINDOW_MARGIN_MM,
      minY:
        runBounds.minY -
        candidateRoute.traceThickness -
        this.input.obstacleMargin -
        LOCAL_ROUTE_WINDOW_MARGIN_MM,
      maxX:
        runBounds.maxX +
        candidateRoute.traceThickness +
        this.input.obstacleMargin +
        LOCAL_ROUTE_WINDOW_MARGIN_MM,
      maxY:
        runBounds.maxY +
        candidateRoute.traceThickness +
        this.input.obstacleMargin +
        LOCAL_ROUTE_WINDOW_MARGIN_MM,
    }

    const keepRouteIndices = new Set<number>([context.routeIndex])
    for (let i = 0; i < hdRoutes.length; i++) {
      if (i === context.routeIndex) continue
      if (this.isRouteNearBounds(hdRoutes[i]!, routeWindow)) {
        keepRouteIndices.add(i)
      }
    }

    const maskedRoutes = hdRoutes.map((route, index) => {
      if (keepRouteIndices.has(index)) return route
      const anchorPoint = route.route[0]
      return {
        ...route,
        route: anchorPoint ? [anchorPoint] : [],
        vias: [],
        jumpers: [],
      }
    })

    return this.runTraceSpacingCheck(maskedRoutes)
  }

  private getNearbyObstaclesForIssue(
    routeLayer: string,
    center: Point,
  ): Obstacle[] {
    const layerObstacles = this.obstaclesByLayer.get(routeLayer) ?? []
    if (layerObstacles.length === 0) return []

    const index = this.obstacleIndexByLayer.get(routeLayer)
    if (!index) return layerObstacles

    const searchRadii = [0.5, 1, 2, 4, 8, 16]
    for (const radius of searchRadii) {
      const nearby = index.search({
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      })
      if (nearby.length > 0) return nearby
    }

    return layerObstacles
  }

  private findObstacleForIssue(
    issue: TraceSpacingIssue,
    routeLayer: string,
  ): Obstacle | null {
    const obstaclesOnLayer = this.obstaclesByLayer.get(routeLayer) ?? []
    if (obstaclesOnLayer.length === 0) return null
    const nearbyObstacles = this.getNearbyObstaclesForIssue(
      routeLayer,
      issue.center,
    )

    const matchingByPortIds =
      issue.pcb_port_ids && issue.pcb_port_ids.length > 0
        ? nearbyObstacles.filter((obstacle) =>
            obstacle.connectedTo.some((id) => issue.pcb_port_ids!.includes(id)),
          )
        : []

    const anyMatchingByPortIds =
      issue.pcb_port_ids && issue.pcb_port_ids.length > 0
        ? obstaclesOnLayer.filter((obstacle) =>
            obstacle.connectedTo.some((id) => issue.pcb_port_ids!.includes(id)),
          )
        : []

    const candidates =
      matchingByPortIds.length > 0
        ? matchingByPortIds
        : anyMatchingByPortIds.length > 0
          ? anyMatchingByPortIds
          : nearbyObstacles

    let best: Obstacle | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const obstacle of candidates) {
      const d = pointToRectDistance(issue.center, obstacle)
      if (d < bestDist) {
        best = obstacle
        bestDist = d
      }
    }
    return best
  }

  private findOffendingSegment(
    route: HighDensityRoute,
    issue: TraceSpacingIssue,
    obstacle: Obstacle | null,
  ): number {
    let bestIndex = -1
    let bestScore = Number.POSITIVE_INFINITY
    for (let i = 0; i < route.route.length - 1; i++) {
      const a = route.route[i]!
      const b = route.route[i + 1]!
      if (a.z !== b.z) continue
      const dCenter = pointToSegmentDistance(issue.center, a, b)
      const expanded =
        obstacle !== null
          ? expandObstacle(
              obstacle,
              route.traceThickness / 2 + this.input.obstacleMargin,
            )
          : null
      const dObstacle =
        expanded === null
          ? 0
          : segmentIntersectsRect(a, b, expanded)
            ? 0
            : Math.min(
                pointToRectDistance(a, expanded),
                pointToRectDistance(b, expanded),
              )
      const score = dCenter * 0.7 + dObstacle * 0.3
      if (score < bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    return bestIndex
  }

  private computeSegmentRun(
    route: HighDensityRoute,
    segmentIndex: number,
  ): {
    runStartSegIndex: number
    runEndSegIndex: number
    axis: "horizontal" | "vertical"
  } {
    const a = route.route[segmentIndex]!
    const b = route.route[segmentIndex + 1]!
    const axis =
      Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "horizontal" : "vertical"
    let runStart = segmentIndex
    let runEnd = segmentIndex

    const isSegmentAligned = (p1: Point3D, p2: Point3D) => {
      if (p1.z !== p2.z) return false
      if (axis === "horizontal") {
        return Math.abs(p1.y - p2.y) < 0.01
      }
      return Math.abs(p1.x - p2.x) < 0.01
    }

    for (let i = segmentIndex - 1; i >= 0; i--) {
      const p1 = route.route[i]!
      const p2 = route.route[i + 1]!
      if (!isSegmentAligned(p1, p2)) break
      runStart = i
    }
    for (let i = segmentIndex + 1; i < route.route.length - 1; i++) {
      const p1 = route.route[i]!
      const p2 = route.route[i + 1]!
      if (!isSegmentAligned(p1, p2)) break
      runEnd = i
    }

    return { runStartSegIndex: runStart, runEndSegIndex: runEnd, axis }
  }

  private startNextIssue(): boolean {
    const issues = this.getCurrentIssues()
    if (issues.length === 0) return false

    const issue = issues[0]!
    const routeIndex = parseRouteIndexFromTraceId(issue.pcb_trace_id)
    if (routeIndex === null || !this.hdRoutes[routeIndex]) {
      this.unresolvedIssueKeys.add(this.buildIssueKey(issue))
      return true
    }

    const route = this.hdRoutes[routeIndex]!
    const routeLayer = routeLayerFromIssue(
      route,
      issue.center,
      this.input.srj.layerCount,
    )
    const obstacle = this.findObstacleForIssue(issue, routeLayer)
    const segmentIndex = this.findOffendingSegment(route, issue, obstacle)
    if (segmentIndex < 0) {
      this.unresolvedIssueKeys.add(this.buildIssueKey(issue))
      return true
    }

    const { runStartSegIndex, runEndSegIndex, axis } = this.computeSegmentRun(
      route,
      segmentIndex,
    )
    const segmentA = route.route[segmentIndex]!
    const segmentB = route.route[segmentIndex + 1]!
    const segmentCenter = {
      x: (segmentA.x + segmentB.x) / 2,
      y: (segmentA.y + segmentB.y) / 2,
    }
    const obstacleCenter = obstacle?.center ?? issue.center
    const preferredSign =
      axis === "horizontal"
        ? segmentCenter.y >= obstacleCenter.y
          ? 1
          : -1
        : segmentCenter.x >= obstacleCenter.x
          ? 1
          : -1

    this.currentIssueContext = {
      issue,
      routeIndex,
      routeLayer,
      obstacle,
      segmentIndex,
      runStartSegIndex,
      runEndSegIndex,
      axis,
      directionOrder: [preferredSign, -preferredSign],
      directionIndex: 0,
      shiftStep: 1,
      previousIssueCount: this.latestIssueCount,
      previousIssueKeys: new Set(issues.map((i) => this.buildIssueKey(i))),
    }
    this.currentCandidateRoute = null

    this.currentObstacleMarginRect =
      obstacle !== null
        ? expandObstacle(
            obstacle,
            route.traceThickness / 2 + this.input.obstacleMargin,
          )
        : null
    return true
  }

  private createShiftedCandidate(
    context: IssueContext,
  ): HighDensityRoute | null {
    const baseRoute = this.hdRoutes[context.routeIndex]!
    let startPointIndex = context.runStartSegIndex
    let endPointIndex = context.runEndSegIndex + 1
    const pointCount = baseRoute.route.length
    if (pointCount < 2) return null

    const firstPoint = baseRoute.route[0]!
    const secondPoint = baseRoute.route[1]!
    const lastPoint = baseRoute.route[pointCount - 1]!
    const beforeLastPoint = baseRoute.route[pointCount - 2]!

    const firstEndpointIsSensitive =
      hasPcbPortId(firstPoint) ||
      this.endpointInsideLayerObstacle(context.routeLayer, firstPoint) ||
      (firstPoint.z !== secondPoint.z &&
        Math.abs(firstPoint.x - secondPoint.x) < 0.01 &&
        Math.abs(firstPoint.y - secondPoint.y) < 0.01)
    const lastEndpointIsSensitive =
      hasPcbPortId(lastPoint) ||
      this.endpointInsideLayerObstacle(context.routeLayer, lastPoint) ||
      (lastPoint.z !== beforeLastPoint.z &&
        Math.abs(lastPoint.x - beforeLastPoint.x) < 0.01 &&
        Math.abs(lastPoint.y - beforeLastPoint.y) < 0.01)

    if (firstEndpointIsSensitive && startPointIndex === 0) startPointIndex = 1
    if (lastEndpointIsSensitive && endPointIndex === pointCount - 1) {
      endPointIndex = pointCount - 2
    }
    if (startPointIndex > endPointIndex) return null

    // Preserve existing via-style transitions: never move only one side.
    for (let i = 1; i < pointCount; i++) {
      const prev = baseRoute.route[i - 1]!
      const curr = baseRoute.route[i]!
      const baseViaStyle =
        prev.z !== curr.z &&
        Math.abs(prev.x - curr.x) < 0.01 &&
        Math.abs(prev.y - curr.y) < 0.01
      if (!baseViaStyle) continue
      const prevMoved = i - 1 >= startPointIndex && i - 1 <= endPointIndex
      const currMoved = i >= startPointIndex && i <= endPointIndex
      if (prevMoved !== currMoved) return null
    }

    const candidate = cloneRoute(baseRoute)
    const shiftDistance = context.shiftStep * SHIFT_INCREMENT_MM
    const signedShift =
      context.directionOrder[context.directionIndex] * shiftDistance

    for (let i = startPointIndex; i <= endPointIndex; i++) {
      const point = candidate.route[i]!
      if (hasPcbPortId(point)) {
        return null
      }
      if (context.axis === "horizontal") {
        point.y += signedShift
      } else {
        point.x += signedShift
      }
    }

    candidate.vias = recomputeViasFromRoute(candidate)
    return candidate
  }

  private endpointInsideLayerObstacle(
    routeLayer: string,
    point: Point3,
  ): boolean {
    const layerObstacles = this.obstaclesByLayer.get(routeLayer) ?? []
    for (const obstacle of layerObstacles) {
      if (pointToRectDistance(point, obstacle) <= 0.001) return true
    }
    return false
  }

  private advanceAttemptCursor(context: IssueContext) {
    context.shiftStep++
    if (context.shiftStep <= MAX_SHIFT_STEPS) return
    context.shiftStep = 1
    context.directionIndex++
  }

  private finishIssueAsUnresolved(context: IssueContext) {
    this.unresolvedIssueKeys.add(this.buildIssueKey(context.issue))
    this.currentIssueContext = null
    this.currentCandidateRoute = null
    this.currentObstacleMarginRect = null
  }

  private candidateStillViolatesCurrentObstacleMargin(
    context: IssueContext,
    candidateRoute: HighDensityRoute,
  ): boolean {
    const obstacleRect = this.currentObstacleMarginRect
    if (!obstacleRect) return false

    for (
      let segIndex = context.runStartSegIndex;
      segIndex <= context.runEndSegIndex;
      segIndex++
    ) {
      const a = candidateRoute.route[segIndex]!
      const b = candidateRoute.route[segIndex + 1]!
      if (a.z !== b.z) continue

      if (segmentIntersectsRect(a, b, obstacleRect)) return true
      if (
        pointInsideRect(a, obstacleRect) ||
        pointInsideRect(b, obstacleRect)
      ) {
        return true
      }
    }

    return false
  }

  private processCurrentIssue() {
    const context = this.currentIssueContext
    if (!context) return
    if (context.directionIndex > 1) {
      this.finishIssueAsUnresolved(context)
      return
    }

    const candidateRoute = this.createShiftedCandidate(context)
    if (!candidateRoute) {
      this.advanceAttemptCursor(context)
      return
    }
    this.currentCandidateRoute = candidateRoute
    if (
      this.candidateStillViolatesCurrentObstacleMargin(context, candidateRoute)
    ) {
      this.advanceAttemptCursor(context)
      if (context.directionIndex > 1) {
        this.finishIssueAsUnresolved(context)
      }
      return
    }

    const candidateHdRoutes = this.hdRoutes.map(cloneRoute)
    candidateHdRoutes[context.routeIndex] = candidateRoute
    const localCandidateIssues = this.runLocalTraceSpacingCheck(
      candidateHdRoutes,
      context,
      candidateRoute,
    )
    const localIssueStillPresent = localCandidateIssues.some((issue) =>
      sameIssue(issue, context.issue),
    )
    if (localIssueStillPresent) {
      this.advanceAttemptCursor(context)
      if (context.directionIndex > 1) {
        this.finishIssueAsUnresolved(context)
      }
      return
    }
    const localCandidateIssueKeys = new Set(
      localCandidateIssues.map((issue) => this.buildIssueKey(issue)),
    )
    const localIntroducedNewIssue = [...localCandidateIssueKeys].some(
      (key) => !context.previousIssueKeys.has(key),
    )
    if (localIntroducedNewIssue) {
      this.advanceAttemptCursor(context)
      if (context.directionIndex > 1) {
        this.finishIssueAsUnresolved(context)
      }
      return
    }
    const candidateIssues = this.runTraceSpacingCheck(candidateHdRoutes)

    const issueStillPresent = candidateIssues.some((issue) =>
      sameIssue(issue, context.issue),
    )
    const candidateIssueKeys = new Set(
      candidateIssues.map((issue) => this.buildIssueKey(issue)),
    )
    const introducedNewIssue = [...candidateIssueKeys].some(
      (key) => !context.previousIssueKeys.has(key),
    )

    if (!issueStillPresent && !introducedNewIssue) {
      this.hdRoutes = candidateHdRoutes
      this.currentIssueContext = null
      this.currentCandidateRoute = null
      this.currentObstacleMarginRect = null
      this.cachedIssues = candidateIssues
      this.latestIssueCount = candidateIssues.length
      return
    }

    this.advanceAttemptCursor(context)
    if (context.directionIndex > 1) {
      this.finishIssueAsUnresolved(context)
    }
  }

  _step() {
    if (!this.currentIssueContext) {
      const hasIssue = this.startNextIssue()
      if (!hasIssue) {
        this.solved = true
      }
      return
    }

    this.processCurrentIssue()
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject & {
      lines: NonNullable<GraphicsObject["lines"]>
      rects: NonNullable<GraphicsObject["rects"]>
      points: NonNullable<GraphicsObject["points"]>
      circles: NonNullable<GraphicsObject["circles"]>
    } = {
      lines: [],
      rects: [],
      points: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Trace Margin DRC Repair Solver",
    }

    if (this.currentIssueContext) {
      const context = this.currentIssueContext
      const originalRoute = this.hdRoutes[context.routeIndex]
      if (context.obstacle) {
        graphics.rects.push({
          center: context.obstacle.center,
          width: context.obstacle.width,
          height: context.obstacle.height,
          fill: "rgba(255, 0, 0, 0.3)",
          label: "DRC obstacle",
        })
      }
      if (this.currentObstacleMarginRect) {
        graphics.rects.push({
          center: this.currentObstacleMarginRect.center,
          width: this.currentObstacleMarginRect.width,
          height: this.currentObstacleMarginRect.height,
          fill: "rgba(255, 128, 0, 0.12)",
          label: "required margin",
        })
      }

      if (originalRoute) {
        graphics.lines.push(
          ...routeToGraphicsLines(originalRoute, "rgba(220, 20, 20, 0.9)"),
        )
      }
      if (this.currentCandidateRoute) {
        graphics.lines.push(
          ...routeToGraphicsLines(
            this.currentCandidateRoute,
            "rgba(32, 32, 32, 0.95)",
          ),
        )
      }

      graphics.points.push({
        x: context.issue.center.x,
        y: context.issue.center.y,
        color: "red",
        label: context.issue.message ?? "Trace spacing issue",
      })
      return graphics
    }

    // Final visualization: old traces + repaired traces, with repaired routes emphasized
    for (const route of this.originalHdRoutes) {
      graphics.lines.push(
        ...routeToGraphicsLines(route, "rgba(220, 20, 20, 0.35)", 0.08),
      )
    }
    for (let i = 0; i < this.hdRoutes.length; i++) {
      const route = this.hdRoutes[i]!
      const original = this.originalHdRoutes[i]
      const changed =
        JSON.stringify(route.route) !== JSON.stringify(original?.route ?? [])
      const color = changed ? "rgba(20, 20, 20, 0.95)" : "rgba(0, 0, 0, 0.5)"
      graphics.lines.push(...routeToGraphicsLines(route, color))
    }

    return graphics
  }
}
