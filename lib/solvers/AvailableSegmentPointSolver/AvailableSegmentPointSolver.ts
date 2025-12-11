import { distance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type AvailablePortPoint = PortPoint & {
  id: string
  nodeId: CapacityMeshNodeId
  sharedEdgeId: string
}

type PortPointPair = {
  a: AvailablePortPoint
  b: AvailablePortPoint
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
  }

  const y = (yOverlap.start + yOverlap.end) / 2
  return {
    start: { x: xOverlap.start, y },
    end: { x: xOverlap.end, y },
  }
}

export class AvailableSegmentPointSolver extends BaseSolver {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  traceWidth: number

  availablePortPointsByNode: Map<CapacityMeshNodeId, AvailablePortPoint[]>
  sharedPortPointPairs: PortPointPair[]

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
    this.availablePortPointsByNode = new Map()
    this.sharedPortPointPairs = []
  }

  _step() {
    for (const edge of this.edges) {
      const [nodeAId, nodeBId] = edge.nodeIds
      const nodeA = this.nodes.find((n) => n.capacityMeshNodeId === nodeAId)
      const nodeB = this.nodes.find((n) => n.capacityMeshNodeId === nodeBId)
      if (!nodeA || !nodeB) continue

      const overlapping = findOverlappingSegment(nodeA, nodeB)
      const length = distance(overlapping.start, overlapping.end)

      const commonZ = nodeA.availableZ.filter((z) =>
        nodeB.availableZ.includes(z),
      )
      const availableZ = commonZ.length > 0 ? commonZ : [0]

      const portCount = Math.max(1, Math.floor(length / this.traceWidth))
      for (let i = 1; i <= portCount; i++) {
        const t = i / (portCount + 1)
        const point = {
          x:
            overlapping.start.x + (overlapping.end.x - overlapping.start.x) * t,
          y:
            overlapping.start.y + (overlapping.end.y - overlapping.start.y) * t,
          z: availableZ[0],
        }

        const idBase = `${edge.capacityMeshEdgeId ?? `${nodeAId}-${nodeBId}`}-${i}`

        const portA: AvailablePortPoint = {
          id: `${idBase}-${nodeAId}`,
          nodeId: nodeAId,
          sharedEdgeId: edge.capacityMeshEdgeId ?? `${nodeAId}-${nodeBId}`,
          neighborNodeId: nodeBId,
          ...point,
        }

        const portB: AvailablePortPoint = {
          id: `${idBase}-${nodeBId}`,
          nodeId: nodeBId,
          sharedEdgeId: edge.capacityMeshEdgeId ?? `${nodeAId}-${nodeBId}`,
          neighborNodeId: nodeAId,
          ...point,
        }

        this.sharedPortPointPairs.push({ a: portA, b: portB })
        this.availablePortPointsByNode.set(nodeAId, [
          ...(this.availablePortPointsByNode.get(nodeAId) ?? []),
          portA,
        ])
        this.availablePortPointsByNode.set(nodeBId, [
          ...(this.availablePortPointsByNode.get(nodeBId) ?? []),
          portB,
        ])
      }
    }

    this.solved = true
  }

  getAvailablePortPoints(nodeId: CapacityMeshNodeId) {
    if (!this.solved)
      throw new Error("AvailableSegmentPointSolver not solved yet")
    return this.availablePortPointsByNode.get(nodeId) ?? []
  }

  getPortPointPairs(): PortPointPair[] {
    if (!this.solved)
      throw new Error("AvailableSegmentPointSolver not solved yet")
    return this.sharedPortPointPairs
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      rects: [],
      circles: [],
    }

    this.sharedPortPointPairs.forEach(({ a, b }) => {
      graphics.lines!.push({
        points: [
          { x: a.x, y: a.y },
          { x: b.x + 0.01, y: b.y + 0.01 },
        ],
        strokeColor: "rgba(0,0,0,0.15)",
        strokeDash: "3 3",
      })

      graphics.points!.push(
        {
          x: a.x,
          y: a.y,
          label: `${a.nodeId}→${a.neighborNodeId}`,
        },
        {
          x: b.x,
          y: b.y,
          label: `${b.nodeId}→${b.neighborNodeId}`,
        },
      )
    })

    return graphics
  }
}

export type { AvailablePortPoint, PortPointPair }
