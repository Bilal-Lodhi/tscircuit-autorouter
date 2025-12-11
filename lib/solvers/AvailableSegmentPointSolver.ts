import { BaseSolver } from "./BaseSolver"
import type { CapacityMeshEdge, CapacityMeshNode } from "lib/types"

export type AvailableSegmentPoint = {
  id: string
  nodeId: string
  edgeId: string
  x: number
  y: number
  z: number
  partnerId: string
}

export class AvailableSegmentPointSolver extends BaseSolver {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  traceWidth: number
  availableSegmentPoints: AvailableSegmentPoint[] = []

  constructor({
    nodes,
    edges,
    traceWidth,
  }: {
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    traceWidth: number
  }) {
    super()
    this.nodes = nodes
    this.edges = edges
    this.traceWidth = traceWidth
    this.MAX_ITERATIONS = 1
  }

  _step() {
    for (const edge of this.edges) {
      const [nodeAId, nodeBId] = edge.nodeIds
      const nodeA = this.nodes.find((n) => n.capacityMeshNodeId === nodeAId)
      const nodeB = this.nodes.find((n) => n.capacityMeshNodeId === nodeBId)
      if (!nodeA || !nodeB) continue

      const mutuallyAvailableZ = nodeA.availableZ.filter((z) =>
        nodeB.availableZ.includes(z),
      )

      if (mutuallyAvailableZ.length === 0) continue

      const segment = findOverlappingSegment(nodeA, nodeB)
      const segLength = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      )
      const portCount = Math.max(1, Math.floor(segLength / this.traceWidth))

      for (const z of mutuallyAvailableZ) {
        for (let i = 1; i <= portCount; i++) {
          const fraction = i / (portCount + 1)
          const x =
            segment.start.x + (segment.end.x - segment.start.x) * fraction
          const y =
            segment.start.y + (segment.end.y - segment.start.y) * fraction

          const idA = `${edge.capacityMeshEdgeId}-${z}-${i}-A`
          const idB = `${edge.capacityMeshEdgeId}-${z}-${i}-B`

          this.availableSegmentPoints.push(
            {
              id: idA,
              nodeId: nodeA.capacityMeshNodeId,
              edgeId: edge.capacityMeshEdgeId,
              x,
              y,
              z,
              partnerId: idB,
            },
            {
              id: idB,
              nodeId: nodeB.capacityMeshNodeId,
              edgeId: edge.capacityMeshEdgeId,
              x,
              y,
              z,
              partnerId: idA,
            },
          )
        }
      }
    }

    this.solved = true
  }
}

function findOverlappingSegment(
  node: CapacityMeshNode,
  adjNode: CapacityMeshNode,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const xOverlap = {
    start: Math.max(
      node.center.x - node.width / 2,
      adjNode.center.x - adjNode.width / 2,
    ),
    end: Math.min(
      node.center.x + node.width / 2,
      adjNode.center.x + adjNode.width / 2,
    ),
  }

  const yOverlap = {
    start: Math.max(
      node.center.y - node.height / 2,
      adjNode.center.y - adjNode.height / 2,
    ),
    end: Math.min(
      node.center.y + node.height / 2,
      adjNode.center.y + adjNode.height / 2,
    ),
  }

  const xRange = xOverlap.end - xOverlap.start
  const yRange = yOverlap.end - yOverlap.start

  if (xRange < yRange) {
    const x = (xOverlap.start + xOverlap.end) / 2
    return {
      start: { x, y: yOverlap.start },
      end: { x, y: yOverlap.end },
    }
  } else {
    const y = (yOverlap.start + yOverlap.end) / 2
    return {
      start: { x: xOverlap.start, y },
      end: { x: xOverlap.end, y },
    }
  }
}
