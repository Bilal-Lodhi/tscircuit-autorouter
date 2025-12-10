import { BaseSolver } from "lib/solvers/BaseSolver"
import type { CapacityMeshNode } from "lib/types"

type CapacityNodeAspectRatioSolverParams = {
  nodes: CapacityMeshNode[]
  maxAspectRatio?: number
}

export class CapacityNodeAspectRatioSolver extends BaseSolver {
  nodes: CapacityMeshNode[]
  maxAspectRatio: number

  constructor({
    nodes,
    maxAspectRatio = 1.2,
  }: CapacityNodeAspectRatioSolverParams) {
    super()
    this.nodes = nodes
    this.maxAspectRatio = maxAspectRatio
    this.MAX_ITERATIONS = 1
  }

  _step() {
    const splitNodes: CapacityMeshNode[] = []

    for (const node of this.nodes) {
      const minDimension = Math.min(node.width, node.height)

      if (minDimension === 0) {
        splitNodes.push(node)
        continue
      }

      const aspectRatio = Math.max(node.width, node.height) / minDimension

      if (aspectRatio <= this.maxAspectRatio) {
        splitNodes.push(node)
        continue
      }

      if (node.width >= node.height) {
        const splitCount = Math.max(
          1,
          Math.ceil(node.width / (node.height * this.maxAspectRatio)),
        )
        const segmentWidth = node.width / splitCount
        const startX = node.center.x - node.width / 2

        for (let i = 0; i < splitCount; i++) {
          const centerX = startX + segmentWidth * (i + 0.5)
          splitNodes.push(
            this.createSplitNode(node, i, {
              center: { x: centerX, y: node.center.y },
              width: segmentWidth,
              height: node.height,
            }),
          )
        }
      } else {
        const splitCount = Math.max(
          1,
          Math.ceil(node.height / (node.width * this.maxAspectRatio)),
        )
        const segmentHeight = node.height / splitCount
        const startY = node.center.y - node.height / 2

        for (let i = 0; i < splitCount; i++) {
          const centerY = startY + segmentHeight * (i + 0.5)
          splitNodes.push(
            this.createSplitNode(node, i, {
              center: { x: node.center.x, y: centerY },
              width: node.width,
              height: segmentHeight,
            }),
          )
        }
      }
    }

    this.nodes = splitNodes
    this.solved = true
  }

  private createSplitNode(
    node: CapacityMeshNode,
    index: number,
    dims: { center: { x: number; y: number }; width: number; height: number },
  ): CapacityMeshNode {
    return {
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}_split${index + 1}`,
      center: dims.center,
      width: dims.width,
      height: dims.height,
      _parent: node,
    }
  }

  getResultNodes() {
    return this.nodes
  }
}
