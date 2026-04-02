import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"

export class NodeDimensionSubdivisionSolver extends BaseSolver {
  public readonly outputNodes: CapacityMeshNode[]

  constructor(
    private readonly nodes: CapacityMeshNode[],
    private readonly maxNodeDimension: number,
    private readonly maxRectRatio = 2,
  ) {
    super()
    this.outputNodes = []
  }

  override getSolverName(): string {
    return "NodeDimensionSubdivisionSolver"
  }

  private getSubdivisionGrid(node: CapacityMeshNode) {
    if (node._containsTarget || node._containsObstacle) {
      return { cols: 1, rows: 1 }
    }

    let cols = 1
    let rows = 1

    if (Number.isFinite(this.maxNodeDimension) && this.maxNodeDimension > 0) {
      cols = Math.max(1, Math.ceil(node.width / this.maxNodeDimension))
      rows = Math.max(1, Math.ceil(node.height / this.maxNodeDimension))
    }

    if (
      Number.isFinite(this.maxRectRatio) &&
      this.maxRectRatio > 0 &&
      node.width > 0 &&
      node.height > 0
    ) {
      const childWidth = node.width / cols
      const childHeight = node.height / rows

      if (childWidth > childHeight * this.maxRectRatio) {
        cols *= 2
      } else if (childHeight > childWidth * this.maxRectRatio) {
        rows *= 2
      }
    }

    return { cols, rows }
  }

  private subdivideNode(node: CapacityMeshNode): CapacityMeshNode[] {
    const { cols, rows } = this.getSubdivisionGrid(node)

    if (cols === 1 && rows === 1) {
      return [node]
    }

    const childWidth = node.width / cols
    const childHeight = node.height / rows
    const minX = node.center.x - node.width / 2
    const minY = node.center.y - node.height / 2

    const childNodes: CapacityMeshNode[] = []

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        childNodes.push({
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}__sub_${row}_${col}`,
          center: {
            x: minX + childWidth * (col + 0.5),
            y: minY + childHeight * (row + 0.5),
          },
          width: childWidth,
          height: childHeight,
          availableZ: [...node.availableZ],
        })
      }
    }

    return childNodes
  }

  override _step() {
    const inputCount = this.nodes.length
    let subdividedNodeCount = 0

    for (const node of this.nodes) {
      const subdividedNodes = this.subdivideNode(node)
      if (subdividedNodes.length > 1) {
        subdividedNodeCount++
      }
      this.outputNodes.push(...subdividedNodes)
    }

    this.stats = {
      inputNodeCount: inputCount,
      outputNodeCount: this.outputNodes.length,
      subdividedNodeCount,
      maxNodeDimension: this.maxNodeDimension,
      maxRectRatio: this.maxRectRatio,
    }
    this.solved = true
  }

  override visualize(): GraphicsObject {
    return {
      rects: this.outputNodes.map((node) => ({
        center: node.center,
        width: node.width,
        height: node.height,
        label: `${node.capacityMeshNodeId}\n${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
        layer: `z${node.availableZ.join(",")}`,
        fill: "rgba(0, 200, 255, 0.08)",
        stroke: "rgba(0, 120, 180, 0.5)",
      })),
    }
  }
}
