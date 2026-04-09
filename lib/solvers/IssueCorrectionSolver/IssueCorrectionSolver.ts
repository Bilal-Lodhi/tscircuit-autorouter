import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import {
  evaluateIssueCorrectionRoutes,
  getIssueCenter,
  getIssueKey,
  getIssueTraceId,
  parseRouteIndexFromTraceId,
  type IssueCorrectionError,
  type IssueCorrectionEvaluation,
} from "./drc"
import {
  clamp,
  clampPointToNode,
  dedupeSequentialRoutePoints,
  distance,
  getSegmentNormal,
  interpolatePointOnSegment,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
  type Point3D,
} from "./geometry"
import {
  createLocalIssueCandidateScore,
  isBetterLocalIssueCandidateScore,
  type LocalIssueCandidateScore,
} from "./localScore"
import {
  buildRouteNodeAssignment,
  findNodeIndexContainingPoint,
} from "./routeNodeAssignment"

type CandidateScore = {
  globalErrorCount: number
  localErrorCount: number
  routeErrorCount: number
}

const DEFAULT_LOCAL_CORRECTION_RADIUS = 0.75
const DEFAULT_REPAIR_MARGIN = 0.2
const DETOUR_CLEARANCE_FACTORS = [1, 1.4, 1.8]
const DETOUR_SPAN_FACTORS = [0.2, 0.35, 0.48]
const MAX_ROUTE_CANDIDATES_PER_ISSUE = 2
const MAX_SEGMENTS_PER_ROUTE = 1
const MAX_CORRECTION_PASSES = 4

const createIssueScore = (
  evaluation: IssueCorrectionEvaluation,
  issue: IssueCorrectionError,
  candidateRouteIndexes: number[],
) => {
  const center = getIssueCenter(issue)
  let localErrorCount = 0
  let routeErrorCount = 0

  for (const error of evaluation.errorsWithCenters) {
    const errorCenter = getIssueCenter(error)
    if (
      center &&
      errorCenter &&
      distance(center, errorCenter) <= DEFAULT_LOCAL_CORRECTION_RADIUS
    ) {
      localErrorCount += 1
    }

    const routeIndex = parseRouteIndexFromTraceId(getIssueTraceId(error))
    if (routeIndex !== null && candidateRouteIndexes.includes(routeIndex)) {
      routeErrorCount += 1
    }
  }

  return {
    globalErrorCount: evaluation.errors.length,
    localErrorCount,
    routeErrorCount,
  }
}

const isBetterScore = (candidate: CandidateScore, baseline: CandidateScore) => {
  if (candidate.globalErrorCount > baseline.globalErrorCount) {
    return false
  }

  if (candidate.localErrorCount !== baseline.localErrorCount) {
    return candidate.localErrorCount < baseline.localErrorCount
  }

  if (candidate.routeErrorCount !== baseline.routeErrorCount) {
    return candidate.routeErrorCount < baseline.routeErrorCount
  }

  return candidate.globalErrorCount < baseline.globalErrorCount
}

const replaceSegmentWithDetour = (
  route: HighDensityRoute,
  segmentIndex: number,
  points: Point3D[],
) => {
  const nextRoute = [
    ...route.route.slice(0, segmentIndex + 1),
    ...points,
    ...route.route.slice(segmentIndex + 1),
  ]

  return {
    ...route,
    route: dedupeSequentialRoutePoints(nextRoute),
  }
}

export class IssueCorrectionSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly nodeWithPortPoints: NodeWithPortPoints[]
  readonly colorMap: Record<string, string>
  readonly repairMargin: number
  readonly connMap: ConnectivityMap | null
  readonly obstacleSHI: ObstacleSpatialHashIndex

  currentHdRoutes: HighDensityRoute[]
  currentEvaluation: IssueCorrectionEvaluation | null = null
  currentRouteSpatialIndex: HighDensityRouteSpatialIndex
  readonly routeNodeAssignment: ReturnType<typeof buildRouteNodeAssignment>
  readonly skippedIssueKeys = new Set<string>()
  correctionsApplied = 0

  constructor(params: {
    simpleRouteJson: SimpleRouteJson
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap | null
    repairMargin?: number
  }) {
    super()
    this.srj = params.simpleRouteJson
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.currentHdRoutes = params.hdRoutes.map((route) =>
      structuredClone(route),
    )
    this.colorMap = params.colorMap ?? {}
    this.connMap = params.connMap ?? null
    this.repairMargin = params.repairMargin ?? DEFAULT_REPAIR_MARGIN
    this.obstacleSHI = new ObstacleSpatialHashIndex(
      "flatbush",
      this.srj.obstacles,
    )
    this.currentRouteSpatialIndex = new HighDensityRouteSpatialIndex(
      this.currentHdRoutes,
    )
    this.routeNodeAssignment = buildRouteNodeAssignment(
      this.currentHdRoutes,
      this.nodeWithPortPoints,
      this.repairMargin,
    )
    this.MAX_ITERATIONS = Math.max(this.currentHdRoutes.length * 200, 10_000)
    this.stats = {
      initialErrorCount: 0,
      finalErrorCount: 0,
      correctionsApplied: 0,
    }
  }

  override getSolverName(): string {
    return "IssueCorrectionSolver"
  }

  override getConstructorParams() {
    return [
      {
        simpleRouteJson: this.srj,
        nodeWithPortPoints: this.nodeWithPortPoints,
        hdRoutes: this.currentHdRoutes,
        colorMap: this.colorMap,
        connMap: this.connMap,
        repairMargin: this.repairMargin,
      },
    ] as const
  }

  private getCandidateRouteIndexes(issue: IssueCorrectionError) {
    const candidateIndexes = new Set<number>()
    const center = getIssueCenter(issue)
    const directRouteIndex = parseRouteIndexFromTraceId(getIssueTraceId(issue))

    if (directRouteIndex !== null) {
      candidateIndexes.add(directRouteIndex)
      const nodeIndex =
        this.routeNodeAssignment.nodeIndexByRoute.get(directRouteIndex)
      if (nodeIndex !== undefined) {
        for (const routeIndex of this.routeNodeAssignment.routeIndexesByNode.get(
          nodeIndex,
        ) ?? []) {
          candidateIndexes.add(routeIndex)
        }
      }
    }

    if (center) {
      const nodeIndex = findNodeIndexContainingPoint(
        center,
        this.nodeWithPortPoints,
        this.repairMargin,
      )
      if (nodeIndex !== -1) {
        for (const routeIndex of this.routeNodeAssignment.routeIndexesByNode.get(
          nodeIndex,
        ) ?? []) {
          candidateIndexes.add(routeIndex)
        }
      }
    }

    return Array.from(candidateIndexes).slice(0, MAX_ROUTE_CANDIDATES_PER_ISSUE)
  }

  private generateLocalizedDetourCandidates(
    route: HighDensityRoute,
    routeIndex: number,
    issue: IssueCorrectionError,
  ) {
    const center = getIssueCenter(issue)
    if (!center) return []

    const nodeIndex = this.routeNodeAssignment.nodeIndexByRoute.get(routeIndex)
    const node =
      nodeIndex === undefined
        ? null
        : (this.nodeWithPortPoints[nodeIndex] ?? null)
    const routeSegmentEntries = route.route
      .slice(0, -1)
      .map((start, segmentIndex) => {
        const end = route.route[segmentIndex + 1]
        return {
          segmentIndex,
          start,
          end,
          distanceToIssue: pointToSegmentDistance(center, start, end),
        }
      })
      .filter(
        (entry) =>
          entry.start.z === entry.end.z &&
          entry.distanceToIssue <= DEFAULT_LOCAL_CORRECTION_RADIUS,
      )
      .sort((a, b) => a.distanceToIssue - b.distanceToIssue)
      .slice(0, MAX_SEGMENTS_PER_ROUTE)

    const candidates: HighDensityRoute[] = []
    const seenRoutes = new Set<string>()
    const minAmplitude = Math.max(route.traceThickness * 1.6, 0.16)
    const maxAmplitude = Math.min(
      Math.max(route.traceThickness * 5, 0.45),
      node ? Math.min(node.width, node.height) * 0.35 : 0.75,
    )

    for (const entry of routeSegmentEntries) {
      const normal = getSegmentNormal(entry.start, entry.end)
      if (!normal) continue

      const closestPoint = pointToSegmentClosestPoint(
        center,
        entry.start,
        entry.end,
      ) as { x: number; y: number }
      const closestDistance = Math.max(entry.distanceToIssue, 0.01)
      const closestDistanceAlong = distance(entry.start, closestPoint)
      for (const spanFactor of DETOUR_SPAN_FACTORS) {
        const tangentSpan = clamp(
          normal.length * spanFactor,
          Math.max(route.traceThickness * 2, 0.12),
          Math.min(normal.length * 0.49, 0.8),
        )
        const enterPoint = interpolatePointOnSegment(
          entry.start,
          entry.end,
          Math.max(0, closestDistanceAlong - tangentSpan),
        )
        const exitPoint = interpolatePointOnSegment(
          entry.start,
          entry.end,
          Math.min(normal.length, closestDistanceAlong + tangentSpan),
        )

        for (const side of [-1, 1] as const) {
          for (const factor of DETOUR_CLEARANCE_FACTORS) {
            const amplitude = clamp(
              (minAmplitude + route.traceThickness - closestDistance) * factor,
              minAmplitude,
              maxAmplitude,
            )
            const offsetX = normal.x * amplitude * side
            const offsetY = normal.y * amplitude * side
            const detourPoints = [
              clampPointToNode(
                {
                  ...enterPoint,
                  x: enterPoint.x + offsetX,
                  y: enterPoint.y + offsetY,
                },
                node,
              ),
              clampPointToNode(
                {
                  x: closestPoint.x + offsetX,
                  y: closestPoint.y + offsetY,
                  z: entry.start.z,
                },
                node,
              ),
              clampPointToNode(
                {
                  ...exitPoint,
                  x: exitPoint.x + offsetX,
                  y: exitPoint.y + offsetY,
                },
                node,
              ),
            ]

            const nextRoute = replaceSegmentWithDetour(
              route,
              entry.segmentIndex,
              detourPoints,
            )
            const routeKey = JSON.stringify(nextRoute.route)
            if (seenRoutes.has(routeKey)) continue
            seenRoutes.add(routeKey)
            candidates.push(nextRoute)
          }
        }
      }
    }

    return candidates
  }

  private attemptCorrection(issue: IssueCorrectionError) {
    if (!this.currentEvaluation) {
      return null
    }

    const candidateRouteIndexes = this.getCandidateRouteIndexes(issue)
    if (candidateRouteIndexes.length === 0) {
      return null
    }

    const baselineScore = createIssueScore(
      this.currentEvaluation,
      issue,
      candidateRouteIndexes,
    )
    const issueCenter = getIssueCenter(issue)
    if (!issueCenter) {
      return null
    }
    let bestRoutes: HighDensityRoute[] | null = null
    let bestEvaluation: IssueCorrectionEvaluation | null = null
    let bestScore = baselineScore

    for (const routeIndex of candidateRouteIndexes) {
      const route = this.currentHdRoutes[routeIndex]
      if (!route) continue

      const baselineLocalScore: LocalIssueCandidateScore =
        createLocalIssueCandidateScore({
          issueCenter,
          candidateRoute: route,
          originalRoute: route,
          currentRouteSpatialIndex: this.currentRouteSpatialIndex,
          obstacleSHI: this.obstacleSHI,
          simpleRouteJson: this.srj,
          connMap: this.connMap,
        })

      const candidates = this.generateLocalizedDetourCandidates(
        route,
        routeIndex,
        issue,
      )

      for (const candidateRoute of candidates) {
        const candidateLocalScore = createLocalIssueCandidateScore({
          issueCenter,
          candidateRoute,
          originalRoute: route,
          currentRouteSpatialIndex: this.currentRouteSpatialIndex,
          obstacleSHI: this.obstacleSHI,
          simpleRouteJson: this.srj,
          connMap: this.connMap,
        })

        if (
          !isBetterLocalIssueCandidateScore(
            candidateLocalScore,
            baselineLocalScore,
          )
        ) {
          continue
        }

        const nextRoutes = this.currentHdRoutes.map((currentRoute, index) =>
          index === routeIndex ? candidateRoute : currentRoute,
        )
        const nextEvaluation = evaluateIssueCorrectionRoutes(this.srj, nextRoutes)
        const nextScore = createIssueScore(
          nextEvaluation,
          issue,
          candidateRouteIndexes,
        )

        if (!isBetterScore(nextScore, bestScore)) continue

        bestRoutes = nextRoutes
        bestEvaluation = nextEvaluation
        bestScore = nextScore

        if (nextScore.globalErrorCount === 0) {
          return {
            routes: bestRoutes,
            evaluation: bestEvaluation,
          }
        }
      }
    }

    if (!bestRoutes || !bestEvaluation) {
      return null
    }

    return {
      routes: bestRoutes,
      evaluation: bestEvaluation,
    }
  }

  override _step() {
    if (!this.currentEvaluation) {
      this.currentEvaluation = evaluateIssueCorrectionRoutes(
        this.srj,
        this.currentHdRoutes,
      )
      this.stats.initialErrorCount = this.currentEvaluation.errors.length
    }

    if (this.currentEvaluation.errors.length === 0) {
      this.stats.finalErrorCount = 0
      this.solved = true
      return
    }

    if (this.correctionsApplied >= MAX_CORRECTION_PASSES) {
      this.stats.finalErrorCount = this.currentEvaluation.errors.length
      this.solved = true
      return
    }

    const nextIssue = this.currentEvaluation.errorsWithCenters.find(
      (error) => !this.skippedIssueKeys.has(getIssueKey(error)),
    )

    if (!nextIssue) {
      this.stats.finalErrorCount = this.currentEvaluation.errors.length
      this.solved = true
      return
    }

    const correction = this.attemptCorrection(nextIssue)

    if (!correction) {
      this.skippedIssueKeys.add(getIssueKey(nextIssue))
      this.stats.finalErrorCount = this.currentEvaluation.errors.length
      return
    }

    this.currentHdRoutes = correction.routes
    this.currentEvaluation = correction.evaluation
    this.currentRouteSpatialIndex = new HighDensityRouteSpatialIndex(
      this.currentHdRoutes,
    )
    this.skippedIssueKeys.clear()
    this.correctionsApplied += 1
    this.stats.correctionsApplied = this.correctionsApplied
    this.stats.finalErrorCount = this.currentEvaluation.errors.length

    if (this.currentEvaluation.errors.length === 0) {
      this.solved = true
    }
  }

  getOutput(): HighDensityRoute[] {
    return this.currentHdRoutes
  }

  override visualize(): GraphicsObject {
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []
    const rects: NonNullable<GraphicsObject["rects"]> = [
      ...this.srj.obstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: obstacle.layers.includes("top")
          ? "rgba(255,0,0,0.12)"
          : "rgba(0,0,255,0.12)",
      })),
    ]

    for (const route of this.currentHdRoutes) {
      const strokeColor = this.colorMap[route.connectionName] ?? "#0ea5e9"
      for (let i = 0; i < route.route.length - 1; i += 1) {
        const start = route.route[i]
        const end = route.route[i + 1]
        if (start.z !== end.z) continue
        lines.push({
          points: [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
          ],
          strokeColor:
            start.z === 0 ? strokeColor : safeTransparentize(strokeColor, 0.5),
          strokeWidth: route.traceThickness,
          layer: `z${start.z}`,
        })
      }

      for (const via of route.vias) {
        circles.push({
          center: via,
          radius: route.viaDiameter / 2,
          stroke: strokeColor,
          fill: "rgba(14,165,233,0.12)",
        })
      }
    }

    for (const error of this.currentEvaluation?.errorsWithCenters ?? []) {
      const center = getIssueCenter(error)
      if (!center) continue
      circles.push({
        center,
        radius: 0.16,
        stroke: "rgba(239,68,68,0.95)",
        fill: "rgba(239,68,68,0.18)",
      })
    }

    return {
      title: "Issue Correction",
      lines,
      circles,
      rects,
    }
  }
}
