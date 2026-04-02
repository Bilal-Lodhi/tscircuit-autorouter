import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import {
  FORCE_VECTOR_DISPLAY_MULTIPLIER,
  type ForceVector,
  runForceDirectedImprovement,
} from "./force-improve"

type ForceImproveSampleEntry = {
  node: NodeWithPortPoints
  routeIndexes: number[]
}

const DEFAULT_NODE_MARGIN = 0.2
const DEFAULT_TOTAL_STEPS = 20

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

export class Pipeline4ForceImproveSolver extends BaseSolver {
  readonly totalSteps: number
  readonly nodeMargin: number
  readonly sampleEntries: ForceImproveSampleEntry[]
  readonly originalHdRoutes: HighDensityRoute[]
  readonly originalNodeWithPortPoints: NodeWithPortPoints[]
  readonly colorMap: Record<string, string>

  improvedRoutesByIndex = new Map<number, HighDensityRoute>()
  forceVectorsByNodeId = new Map<string, ForceVector[]>()
  activeSampleIndex = 0

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    totalSteps?: number
    nodeMargin?: number
    colorMap?: Record<string, string>
  }) {
    super()
    this.totalSteps = params.totalSteps ?? DEFAULT_TOTAL_STEPS
    this.nodeMargin = params.nodeMargin ?? DEFAULT_NODE_MARGIN
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

    this.MAX_ITERATIONS = Math.max(this.sampleEntries.length * 10, 100_000)
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
        colorMap: this.colorMap,
      },
    ] as const
  }

  override _step() {
    const sampleEntry = this.sampleEntries[this.activeSampleIndex]

    if (!sampleEntry) {
      this.solved = true
      return
    }

    const sampleRoutes = sampleEntry.routeIndexes.map((routeIndex) =>
      structuredClone(this.originalHdRoutes[routeIndex]!),
    )

    const result = runForceDirectedImprovement(
      {
        center: sampleEntry.node.center,
        width: sampleEntry.node.width,
        height: sampleEntry.node.height,
      },
      sampleRoutes,
      this.totalSteps,
      { includeForceVectors: true },
    )

    for (let i = 0; i < sampleEntry.routeIndexes.length; i++) {
      const routeIndex = sampleEntry.routeIndexes[i]
      const improvedRoute = result.routes[i]
      this.improvedRoutesByIndex.set(
        routeIndex,
        improvedRoute ?? this.originalHdRoutes[routeIndex]!,
      )
    }

    this.forceVectorsByNodeId.set(
      sampleEntry.node.capacityMeshNodeId,
      result.forceVectors,
    )

    this.activeSampleIndex += 1
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
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []

    for (const route of this.getOutput()) {
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
        })
      }
      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          stroke: strokeColor,
          fill: "rgba(34,197,94,0.12)",
        })
      }
    }

    for (const forceVectors of this.forceVectorsByNodeId.values()) {
      for (const vector of forceVectors) {
        const magnitude = Math.hypot(vector.dx, vector.dy)
        if (magnitude === 0) continue
        lines.push({
          points: [
            { x: vector.x, y: vector.y },
            {
              x: vector.x + vector.dx * FORCE_VECTOR_DISPLAY_MULTIPLIER,
              y: vector.y + vector.dy * FORCE_VECTOR_DISPLAY_MULTIPLIER,
            },
          ],
          strokeColor: "rgba(245,158,11,0.7)",
          strokeWidth: 0.05,
        })
      }
    }

    return {
      title: "Pipeline4 Force Improve",
      lines,
      circles,
    }
  }
}
