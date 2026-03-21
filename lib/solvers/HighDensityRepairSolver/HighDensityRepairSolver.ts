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

export const SINGLE_NODE_REPAIR_ADJACENT_OBSTACLE_MARGIN_MM = 0.1

export const createNodeHdRoutesByNodeId = (
  hdRoutes: HighDensityIntraNodeRoute[],
): Map<string, HighDensityIntraNodeRoute[]> => {
  const nodeHdRoutesByNodeId = new Map<string, HighDensityIntraNodeRoute[]>()

  for (const hdRoute of hdRoutes) {
    const nodeRoutes =
      nodeHdRoutesByNodeId.get(hdRoute.capacityMeshNodeId) ?? []
    nodeRoutes.push(hdRoute)
    nodeHdRoutesByNodeId.set(hdRoute.capacityMeshNodeId, nodeRoutes)
  }

  return nodeHdRoutesByNodeId
}

const getObstacleBounds = (obstacle: Obstacle) => ({
  minX: obstacle.center.x - obstacle.width / 2,
  minY: obstacle.center.y - obstacle.height / 2,
  maxX: obstacle.center.x + obstacle.width / 2,
  maxY: obstacle.center.y + obstacle.height / 2,
})

const getRectDistance = (
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
) => {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0)
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0)
  return Math.hypot(dx, dy)
}

export const getAdjacentObstaclesForNode = (
  nodeWithPortPoints: NodeWithPortPoints,
  obstacleIndex: ObstacleSpatialHashIndex,
  adjacentObstacleMarginMm: number = SINGLE_NODE_REPAIR_ADJACENT_OBSTACLE_MARGIN_MM,
): Obstacle[] => {
  const bounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
  const candidates = obstacleIndex.search({
    minX: bounds.minX - adjacentObstacleMarginMm,
    minY: bounds.minY - adjacentObstacleMarginMm,
    maxX: bounds.maxX + adjacentObstacleMarginMm,
    maxY: bounds.maxY + adjacentObstacleMarginMm,
  })

  return candidates.filter((obstacle) => {
    const obstacleBounds = getObstacleBounds(obstacle)
    return getRectDistance(bounds, obstacleBounds) <= adjacentObstacleMarginMm
  })
}

export const createSingleNodeHighDensityRepairParams = ({
  nodeWithPortPoints,
  obstacleIndex,
  nodeHdRoutesByNodeId,
  connMap,
  adjacentObstacleMarginMm = SINGLE_NODE_REPAIR_ADJACENT_OBSTACLE_MARGIN_MM,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  obstacleIndex: ObstacleSpatialHashIndex
  nodeHdRoutesByNodeId: Map<string, HighDensityIntraNodeRoute[]>
  connMap: ConnectivityMap
  adjacentObstacleMarginMm?: number
}): SingleNodeHighDensityRepairParams => {
  return {
    nodeWithPortPoints,
    adjacentObstacles: getAdjacentObstaclesForNode(
      nodeWithPortPoints,
      obstacleIndex,
      adjacentObstacleMarginMm,
    ),
    nodeHdRoutes:
      nodeHdRoutesByNodeId.get(nodeWithPortPoints.capacityMeshNodeId) ?? [],
    connMap,
  }
}

export const createSingleNodeHighDensityRepairParamsList = ({
  nodePortPoints,
  obstacles,
  hdRoutes,
  connMap,
  adjacentObstacleMarginMm = SINGLE_NODE_REPAIR_ADJACENT_OBSTACLE_MARGIN_MM,
}: HighDensityRepairSolverParams & {
  adjacentObstacleMarginMm?: number
}): SingleNodeHighDensityRepairParams[] => {
  const obstacleIndex = new ObstacleSpatialHashIndex("flatbush", obstacles)
  const nodeHdRoutesByNodeId = createNodeHdRoutesByNodeId(hdRoutes)

  return nodePortPoints.map((nodeWithPortPoints) =>
    createSingleNodeHighDensityRepairParams({
      nodeWithPortPoints,
      obstacleIndex,
      nodeHdRoutesByNodeId,
      connMap,
      adjacentObstacleMarginMm,
    }),
  )
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
    this.nodeHdRoutesByNodeId = createNodeHdRoutesByNodeId(params.hdRoutes)
    this.MAX_ITERATIONS = Math.max(1000, this.unprocessedNodes.length * 4)
  }

  getConstructorParams(): [HighDensityRepairSolverParams] {
    return [this.params]
  }

  private getSingleNodeParams(
    nodeWithPortPoints: NodeWithPortPoints,
  ): SingleNodeHighDensityRepairParams {
    return createSingleNodeHighDensityRepairParams({
      nodeWithPortPoints,
      obstacleIndex: this.obstacleIndex,
      nodeHdRoutesByNodeId: this.nodeHdRoutesByNodeId,
      connMap: this.params.connMap,
    })
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
