import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { computeProjectedRect } from "./geometry"
import type { PolyNodeWithPortPoints } from "./types"

export class AttachProjectedRectsSolver extends BaseSolver {
  override getSolverName(): string {
    return "AttachProjectedRectsSolver"
  }

  outputNodes: PolyNodeWithPortPoints[] = []

  constructor(
    public params: {
      nodesWithPortPoints: PolyNodeWithPortPoints[]
      equivalentAreaExpansionFactor?: number
    },
  ) {
    super()
    this.MAX_ITERATIONS = 1
  }

  _step() {
    this.outputNodes = this.params.nodesWithPortPoints.map((node) => {
      const projectedRect = computeProjectedRect(
        node.polygon,
        this.params.equivalentAreaExpansionFactor ?? 0,
      )
      return {
        ...node,
        center: projectedRect.center,
        width: projectedRect.width,
        height: projectedRect.height,
        projectedRect,
      }
    })
    this.solved = true
  }

  getOutput() {
    return this.outputNodes
  }

  getConstructorParams() {
    return [this.params] as const
  }

  visualize(): GraphicsObject {
    return {
      polygons: this.outputNodes.map((node) => ({
        points: node.polygon,
        fill: "rgba(60, 160, 220, 0.12)",
        stroke: "rgba(40, 90, 150, 0.45)",
        label: node.capacityMeshNodeId,
      })),
      rects: this.outputNodes.flatMap((node) =>
        node.projectedRect
          ? [
              {
                center: node.projectedRect.center,
                width: node.projectedRect.width,
                height: node.projectedRect.height,
                fill: "rgba(255, 165, 0, 0.16)",
                stroke: "rgba(255, 140, 0, 0.8)",
                label: `${node.capacityMeshNodeId} projectedRect`,
              },
            ]
          : [],
      ),
      points: this.outputNodes.flatMap((node) =>
        node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          color: "rgba(30, 30, 30, 0.85)",
          label: point.connectionName,
        })),
      ),
    }
  }
}
