import { BaseSolver } from "../BaseSolver"
import { CapacityMeshNode } from "lib/types"

export type SingleLayerNodeSplitterSolverParams = {
  nodes: CapacityMeshNode[]
  minSingleLayerNodeSize: number
  maxSingleLayerNodeSize: number
}

export class SingleLayerNodeSplitterSolver extends BaseSolver {
  nodes: CapacityMeshNode[]
  minSingleLayerNodeSize: number
  maxSingleLayerNodeSize: number
  newNodes: CapacityMeshNode[] = []

  constructor(params: SingleLayerNodeSplitterSolverParams) {
    super()
    this.nodes = params.nodes
    this.minSingleLayerNodeSize = params.minSingleLayerNodeSize
    this.maxSingleLayerNodeSize = params.maxSingleLayerNodeSize
    this.MAX_ITERATIONS = 1
  }

  private partitionDimension(
    totalSize: number,
    minSize: number,
    maxSize: number,
  ): number[] {
    if (totalSize <= maxSize) return [totalSize]

    const minSegments = Math.ceil(totalSize / maxSize)
    const maxSegments = Math.max(minSegments, Math.floor(totalSize / minSize))

    let chosenSegments = minSegments
    for (let segments = minSegments; segments <= maxSegments; segments++) {
      const size = totalSize / segments
      if (size >= minSize && size <= maxSize) {
        chosenSegments = segments
        break
      }
    }

    const baseSize = totalSize / chosenSegments
    const sizes = Array.from({ length: chosenSegments }, () => baseSize)
    const totalOfSizes = baseSize * chosenSegments
    sizes[sizes.length - 1] += totalSize - totalOfSizes

    return sizes
  }

  private splitNode(node: CapacityMeshNode): CapacityMeshNode[] {
    if (node.availableZ.length !== 1) return [node]

    const widthPartitions = this.partitionDimension(
      node.width,
      this.minSingleLayerNodeSize,
      this.maxSingleLayerNodeSize,
    )
    const heightPartitions = this.partitionDimension(
      node.height,
      this.minSingleLayerNodeSize,
      this.maxSingleLayerNodeSize,
    )

    if (widthPartitions.length === 1 && heightPartitions.length === 1) {
      return [node]
    }

    const minX = node.center.x - node.width / 2
    const minY = node.center.y - node.height / 2

    const splitNodes: CapacityMeshNode[] = []
    let nodeIndex = 0

    let currentY = minY
    for (const height of heightPartitions) {
      let currentX = minX
      for (const width of widthPartitions) {
        const newNode: CapacityMeshNode = {
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}_${nodeIndex++}`,
          width,
          height,
          center: {
            x: currentX + width / 2,
            y: currentY + height / 2,
          },
          _adjacentNodeIds: undefined,
        }
        splitNodes.push(newNode)
        currentX += width
      }
      currentY += height
    }

    return splitNodes
  }

  _step() {
    for (const node of this.nodes) {
      this.newNodes.push(...this.splitNode(node))
    }

    this.solved = true
  }
}
