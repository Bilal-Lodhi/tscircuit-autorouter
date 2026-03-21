import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import {
  SingleNodeHighDensityRepair,
  SingleNodeHighDensityRepairParams,
} from "./SingleNodeHighDensityRepair"

export interface HighDensityRepairSolverParams {
  nodePortPoints: NodeWithPortPoints[]
  obstacles: Obstacle[]
  hdRoutes: HighDensityIntraNodeRoute[]
  connMap: ConnectivityMap
}

export class HighDensityRepairSolver extends BaseSolver {
  override getSolverName(): string {
    return "HighDensityRepairSolver"
  }

  unprocessedNodes: NodeWithPortPoints[]
  repairedHdRoutes: HighDensityIntraNodeRoute[]
  activeSubSolver: SingleNodeHighDensityRepair | null = null
  obstacleIndex: ObstacleSpatialHashIndex
  nodeHdRoutesByNodeId: Map<string, HighDensityIntraNodeRoute[]>

  constructor(public readonly params: HighDensityRepairSolverParams) {
    super()
    this.unprocessedNodes = [...params.nodePortPoints]
    this.repairedHdRoutes = []
    this.obstacleIndex = new ObstacleSpatialHashIndex(
      "flatbush",
      params.obstacles,
    )
    this.nodeHdRoutesByNodeId = new Map()
    this.MAX_ITERATIONS = Math.max(1000, this.unprocessedNodes.length * 4)

    for (const hdRoute of params.hdRoutes) {
      const nodeRoutes =
        this.nodeHdRoutesByNodeId.get(hdRoute.capacityMeshNodeId) ?? []
      nodeRoutes.push(hdRoute)
      this.nodeHdRoutesByNodeId.set(hdRoute.capacityMeshNodeId, nodeRoutes)
    }
  }

  getConstructorParams(): [HighDensityRepairSolverParams] {
    return [this.params]
  }

  private getSingleNodeParams(
    nodeWithPortPoints: NodeWithPortPoints,
  ): SingleNodeHighDensityRepairParams {
    const bounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
    return {
      nodeWithPortPoints,
      adjacentObstacles: this.obstacleIndex.search(bounds),
      nodeHdRoutes:
        this.nodeHdRoutesByNodeId.get(nodeWithPortPoints.capacityMeshNodeId) ??
        [],
      connMap: this.params.connMap,
    }
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()

      if (this.activeSubSolver.solved) {
        this.repairedHdRoutes.push(...this.activeSubSolver.repairedNodeHdRoutes)
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver.error
        this.failed = true
      }
      return
    }

    const nodeToRepair = this.unprocessedNodes.shift()
    if (!nodeToRepair) {
      this.solved = true
      return
    }

    this.activeSubSolver = new SingleNodeHighDensityRepair(
      this.getSingleNodeParams(nodeToRepair),
    )
  }

  visualize(): GraphicsObject {
    const repairedLines = this.repairedHdRoutes.map((route) => ({
      points: route.route.map((point) => ({ x: point.x, y: point.y })),
      strokeColor: "rgba(0, 180, 120, 0.65)",
      strokeWidth: route.traceThickness,
      label: `${route.capacityMeshNodeId}:${route.connectionName}`,
    }))

    if (this.activeSubSolver) {
      const activeViz = this.activeSubSolver.visualize()
      return {
        lines: [...repairedLines, ...(activeViz.lines ?? [])],
        points: activeViz.points ?? [],
        rects: activeViz.rects ?? [],
        circles: activeViz.circles ?? [],
      }
    }

    return {
      lines: repairedLines,
      points: [],
      rects: [],
      circles: [],
    }
  }
}
