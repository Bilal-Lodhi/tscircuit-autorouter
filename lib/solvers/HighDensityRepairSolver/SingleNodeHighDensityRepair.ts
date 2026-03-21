import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

export interface SingleNodeHighDensityRepairParams {
  nodeWithPortPoints: NodeWithPortPoints
  adjacentObstacles: Obstacle[]
  nodeHdRoutes: HighDensityIntraNodeRoute[]
  connMap: ConnectivityMap
}

export class SingleNodeHighDensityRepair extends BaseSolver {
  override getSolverName(): string {
    return "SingleNodeHighDensityRepair"
  }

  nodeWithPortPoints: NodeWithPortPoints
  adjacentObstacles: Obstacle[]
  nodeHdRoutes: HighDensityIntraNodeRoute[]
  connMap: ConnectivityMap
  repairedNodeHdRoutes: HighDensityIntraNodeRoute[]

  constructor(params: SingleNodeHighDensityRepairParams) {
    super()
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.adjacentObstacles = params.adjacentObstacles
    this.nodeHdRoutes = params.nodeHdRoutes
    this.connMap = params.connMap
    this.repairedNodeHdRoutes = []
    this.MAX_ITERATIONS = 10
  }

  getConstructorParams(): [SingleNodeHighDensityRepairParams] {
    return [
      {
        nodeWithPortPoints: this.nodeWithPortPoints,
        adjacentObstacles: this.adjacentObstacles,
        nodeHdRoutes: this.nodeHdRoutes,
        connMap: this.connMap,
      },
    ]
  }

  _step() {
    this.repairedNodeHdRoutes = this.nodeHdRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
      jumpers: route.jumpers?.map((jumper) => ({
        ...jumper,
        start: { ...jumper.start },
        end: { ...jumper.end },
      })),
    }))
    this.solved = true
  }

  visualize(): GraphicsObject {
    const node = this.nodeWithPortPoints
    const graphics: GraphicsObject = {
      rects: [
        {
          center: node.center,
          width: node.width,
          height: node.height,
          fill: "rgba(0, 160, 255, 0.08)",
          stroke: "rgba(0, 160, 255, 0.6)",
          label: node.capacityMeshNodeId,
        },
        ...this.adjacentObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255, 0, 0, 0.08)",
          stroke: "rgba(255, 0, 0, 0.3)",
          label: obstacle.obstacleId,
        })),
      ],
      lines: this.repairedNodeHdRoutes.map((route) => ({
        points: route.route.map((point) => ({ x: point.x, y: point.y })),
        strokeColor: "rgba(0, 160, 255, 0.85)",
        strokeWidth: route.traceThickness,
        label: route.connectionName,
      })),
      points: [],
      circles: [],
    }

    return graphics
  }
}
