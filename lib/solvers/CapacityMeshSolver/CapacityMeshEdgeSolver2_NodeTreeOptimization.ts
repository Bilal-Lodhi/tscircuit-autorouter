import type { CapacityMeshNode } from "../../types/capacity-mesh-types"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import {
  areRoutingAdjacent,
  getMaxRoutingAdjacencyGap,
} from "./areRoutingAdjacent"

export class CapacityMeshEdgeSolver2_NodeTreeOptimization extends CapacityMeshEdgeSolver {
  override getSolverName(): string {
    return "CapacityMeshEdgeSolver2_NodeTreeOptimization"
  }

  private nodeTree: CapacityNodeTree
  private currentNodeIndex: number
  private edgeSet: Set<string>
  private maxNodeWidth: number
  private maxNodeHeight: number

  constructor(public nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    this.nodeTree = new CapacityNodeTree(this.nodes)
    this.currentNodeIndex = 0
    this.edgeSet = new Set<string>()
    this.maxNodeWidth = Math.max(...this.nodes.map((node) => node.width), 0)
    this.maxNodeHeight = Math.max(...this.nodes.map((node) => node.height), 0)
  }

  _step() {
    if (this.currentNodeIndex >= this.nodes.length) {
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const A = this.nodes[this.currentNodeIndex]
    const maybeAdjNodes = this.nodeTree.getNodesInArea(
      A.center.x,
      A.center.y,
      A.width + this.maxNodeWidth + getMaxRoutingAdjacencyGap() * 2,
      A.height + this.maxNodeHeight + getMaxRoutingAdjacencyGap() * 2,
    )

    for (const B of maybeAdjNodes) {
      const strawNodesWithSameParent =
        A._strawNode &&
        B._strawNode &&
        A._strawParentCapacityMeshNodeId === B._strawParentCapacityMeshNodeId
      if (
        A.capacityMeshNodeId !== B.capacityMeshNodeId && // Don't connect a node to itself
        !strawNodesWithSameParent &&
        areRoutingAdjacent(A, B) &&
        !this.edgeSet.has(`${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`)
      ) {
        this.edgeSet.add(`${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`)
        this.edgeSet.add(`${B.capacityMeshNodeId}-${A.capacityMeshNodeId}`)
        this.addEdge(A.capacityMeshNodeId, B.capacityMeshNodeId)
      }
    }

    this.currentNodeIndex++
  }
}
