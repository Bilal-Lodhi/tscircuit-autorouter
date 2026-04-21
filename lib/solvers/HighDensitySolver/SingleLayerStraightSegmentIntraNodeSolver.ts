import {
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type Point2 = { x: number; y: number }

type PairTask = {
  connectionName: string
  rootConnectionName: string
  A: PortPoint
  B: PortPoint
}

type ObstacleSegment = {
  A: Point2
  B: Point2
  rootConnectionName: string
}

const EPS = 1e-6

const samePoint = (a: Point2, b: Point2) =>
  Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

const uniqueAvailableZ = (node: NodeWithPortPoints) => {
  if (node.availableZ?.length) {
    return [...new Set(node.availableZ)].sort((a, b) => a - b)
  }
  return [...new Set(node.portPoints.map((p) => p.z ?? 0))].sort(
    (a, b) => a - b,
  )
}

const segmentIntersectsForeignPort = (
  A: Point2,
  B: Point2,
  foreignPorts: Point2[],
) => {
  for (const port of foreignPorts) {
    if (samePoint(port, A) || samePoint(port, B)) continue
    if (pointToSegmentDistance(port, A, B) < 1e-4) {
      return true
    }
  }
  return false
}

const segmentIntersectsObstacles = (
  A: Point2,
  B: Point2,
  obstacleSegments: ObstacleSegment[],
) => {
  for (const segment of obstacleSegments) {
    if (
      samePoint(A, segment.A) ||
      samePoint(A, segment.B) ||
      samePoint(B, segment.A) ||
      samePoint(B, segment.B)
    ) {
      continue
    }
    if (doSegmentsIntersect(A, B, segment.A, segment.B)) {
      return true
    }
  }
  return false
}

const getObstacleSegments = (
  routes: HighDensityIntraNodeRoute[],
  currentRootConnectionName: string,
) => {
  const segments: ObstacleSegment[] = []
  for (const route of routes) {
    const routeRoot = route.rootConnectionName ?? route.connectionName
    if (routeRoot === currentRootConnectionName) continue
    for (let i = 0; i < route.route.length - 1; i++) {
      const A = route.route[i]!
      const B = route.route[i + 1]!
      if (A.z !== B.z) continue
      segments.push({
        A: { x: A.x, y: A.y },
        B: { x: B.x, y: B.y },
        rootConnectionName: routeRoot,
      })
    }
  }
  return segments
}

const getForeignPorts = (
  node: NodeWithPortPoints,
  currentRootConnectionName: string,
) =>
  node.portPoints
    .filter(
      (point) =>
        (point.rootConnectionName ?? point.connectionName) !==
        currentRootConnectionName,
    )
    .map((point) => ({ x: point.x, y: point.y }))

export class SingleLayerStraightSegmentIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleLayerStraightSegmentIntraNodeSolver"
  }

  nodeWithPortPoints: NodeWithPortPoints
  traceWidth: number
  viaDiameter: number
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    traceWidth?: number
    viaDiameter?: number
  }) {
    super()
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.traceWidth = params.traceWidth ?? 0.15
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.MAX_ITERATIONS = 1
  }

  static isApplicable(node: NodeWithPortPoints) {
    const availableZ = uniqueAvailableZ(node)
    if (availableZ.length !== 1) return false

    const crossings = getIntraNodeCrossings(node)
    if (crossings.numSameLayerCrossings !== 0) return false
    if (crossings.numEntryExitLayerChanges !== 0) return false
    if (crossings.numTransitionPairCrossings !== 0) return false

    const pointCountByConnection = new Map<string, number>()
    for (const portPoint of node.portPoints) {
      pointCountByConnection.set(
        portPoint.connectionName,
        (pointCountByConnection.get(portPoint.connectionName) ?? 0) + 1,
      )
    }

    if (pointCountByConnection.size === 0) return false
    return [...pointCountByConnection.values()].every(
      (count) => count % 2 === 0,
    )
  }

  private buildPairTasks() {
    const groups = new Map<string, PortPoint[]>()
    for (const portPoint of this.nodeWithPortPoints.portPoints) {
      const existing = groups.get(portPoint.connectionName) ?? []
      existing.push(portPoint)
      groups.set(portPoint.connectionName, existing)
    }

    const pairTasks: PairTask[] = []
    for (const [connectionName, points] of groups) {
      if (points.length < 2) continue
      if (points.length % 2 !== 0) return null

      for (let i = 0; i < points.length; i += 2) {
        const A = points[i]!
        const B = points[i + 1]!
        if (samePoint(A, B)) continue

        pairTasks.push({
          connectionName,
          rootConnectionName:
            A.rootConnectionName ?? B.rootConnectionName ?? connectionName,
          A,
          B,
        })
      }
    }

    return pairTasks
  }

  private trySolveNode() {
    const availableZ = uniqueAvailableZ(this.nodeWithPortPoints)
    if (availableZ.length !== 1) return null

    const pairTasks = this.buildPairTasks()
    if (!pairTasks || pairTasks.length === 0) return null

    const solvedRoutes: HighDensityIntraNodeRoute[] = []
    for (const task of pairTasks) {
      const A = { x: task.A.x, y: task.A.y }
      const B = { x: task.B.x, y: task.B.y }

      const obstacleSegments = getObstacleSegments(
        solvedRoutes,
        task.rootConnectionName,
      )
      const foreignPorts = getForeignPorts(
        this.nodeWithPortPoints,
        task.rootConnectionName,
      )

      if (segmentIntersectsObstacles(A, B, obstacleSegments)) {
        return null
      }

      if (segmentIntersectsForeignPort(A, B, foreignPorts)) {
        return null
      }

      solvedRoutes.push({
        connectionName: task.connectionName,
        rootConnectionName: task.rootConnectionName,
        traceThickness: this.traceWidth,
        viaDiameter: this.viaDiameter,
        route: [
          { x: task.A.x, y: task.A.y, z: task.A.z },
          { x: task.B.x, y: task.B.y, z: task.B.z },
        ],
        vias: [],
      })
    }

    return solvedRoutes
  }

  _step() {
    const solvedRoutes = this.trySolveNode()
    if (!solvedRoutes) {
      this.failed = true
      this.error = "Failed to find a single-layer straight-segment route set"
      return
    }

    this.solvedRoutes = solvedRoutes
    this.progress = 1
    this.stats = {
      routeCount: solvedRoutes.length,
      distinctRoots: new Set(
        solvedRoutes.map(
          (route) => route.rootConnectionName ?? route.connectionName,
        ),
      ).size,
    }
    this.solved = true
  }

  visualize(): GraphicsObject {
    return {
      lines: this.solvedRoutes.map((route) => ({
        points: route.route,
        strokeColor: "lime",
        strokeWidth: route.traceThickness,
        label: `${route.connectionName}\nroot: ${route.rootConnectionName ?? route.connectionName}`,
      })),
      points: this.nodeWithPortPoints.portPoints.map((point) => ({
        x: point.x,
        y: point.y,
        color: "blue",
        label: `${point.connectionName}\nroot: ${point.rootConnectionName ?? point.connectionName}`,
      })),
      rects: [],
      circles: [],
    }
  }
}
