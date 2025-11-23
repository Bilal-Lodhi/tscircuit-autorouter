import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
} from "../../types/capacity-mesh-types"
import { BaseSolver } from "../BaseSolver"
import { distance } from "@tscircuit/math-utils"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { CapacityMeshEdgeSolver } from "./CapacityMeshEdgeSolver"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"

export class CapacityMeshEdgeSolver2_NodeTreeOptimization extends CapacityMeshEdgeSolver {
  private nodeTree: CapacityNodeTree
  private currentNodeIndex: number
  private edgeSet: Set<string>

  constructor(public nodes: CapacityMeshNode[]) {
    super(nodes)
    this.MAX_ITERATIONS = 10e6
    this.nodeTree = new CapacityNodeTree(this.nodes)
    this.currentNodeIndex = 0
    this.edgeSet = new Set<string>()
  }

  private addOffBoardConnectionEdges() {
    const offBoardIdToNodes = new Map<string, CapacityMeshNode[]>()

    for (const node of this.nodes) {
      const offBoardIds = node._offBoardConnectionIds
      if (!offBoardIds || offBoardIds.length === 0) continue

      for (const offBoardId of offBoardIds) {
        const nodes = offBoardIdToNodes.get(offBoardId) ?? []
        nodes.push(node)
        offBoardIdToNodes.set(offBoardId, nodes)
      }
    }

    for (const nodes of offBoardIdToNodes.values()) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const A = nodes[i]
          const B = nodes[j]
          const edgeKey = `${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`
          if (this.edgeSet.has(edgeKey)) continue

          this.edgeSet.add(edgeKey)
          this.edgeSet.add(`${B.capacityMeshNodeId}-${A.capacityMeshNodeId}`)
          this.edges.push({
            capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
            nodeIds: [A.capacityMeshNodeId, B.capacityMeshNodeId],
          })
        }
      }
    }
  }

  _step() {
    if (this.currentNodeIndex >= this.nodes.length) {
      this.addOffBoardConnectionEdges()
      this.handleTargetNodes()
      this.solved = true
      return
    }

    const A = this.nodes[this.currentNodeIndex]
    const maybeAdjNodes = this.nodeTree.getNodesInArea(
      A.center.x,
      A.center.y,
      A.width * 2,
      A.height * 2,
    )

    for (const B of maybeAdjNodes) {
      const areBordering = areNodesBordering(A, B)
      if (!areBordering) continue
      const strawNodesWithSameParent =
        A._strawNode &&
        B._strawNode &&
        A._strawParentCapacityMeshNodeId === B._strawParentCapacityMeshNodeId
      if (
        A.capacityMeshNodeId !== B.capacityMeshNodeId && // Don't connect a node to itself
        !strawNodesWithSameParent &&
        this.doNodesHaveSharedLayer(A, B) &&
        !this.edgeSet.has(`${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`)
      ) {
        this.edgeSet.add(`${A.capacityMeshNodeId}-${B.capacityMeshNodeId}`)
        this.edgeSet.add(`${B.capacityMeshNodeId}-${A.capacityMeshNodeId}`)
        this.edges.push({
          capacityMeshEdgeId: this.getNextCapacityMeshEdgeId(),
          nodeIds: [A.capacityMeshNodeId, B.capacityMeshNodeId],
        })
      }
    }

    this.currentNodeIndex++
  }
}
