import { distance } from "@tscircuit/math-utils"
import type { GraphicsObject, Line } from "graphics-debug"
import {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import { getIntraNodeCrossingsFromSegmentPoints } from "lib/utils/getIntraNodeCrossingsFromSegmentPoints"
import { BaseSolver } from "../BaseSolver"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"
import type {
  AvailablePortPoint,
  PortPointPair,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SegmentPoint } from "../UnravelSolver/types"

function isPointInsideNode(node: CapacityMeshNode, x: number, y: number) {
  return (
    x >= node.center.x - node.width / 2 &&
    x <= node.center.x + node.width / 2 &&
    y >= node.center.y - node.height / 2 &&
    y <= node.center.y + node.height / 2
  )
}

export class PortPointPathingSolver extends BaseSolver {
  srj: SimpleRouteJson
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  portPointPairs: PortPointPair[]
  availablePortPointsByNode: Map<CapacityMeshNodeId, AvailablePortPoint[]>
  colorMap: Record<string, string>

  nodePf: Map<CapacityMeshNodeId, number>
  nodeWithPortPoints: NodeWithPortPoints[]

  constructor({
    simpleRouteJson,
    nodes,
    edges,
    portPointPairs,
    availablePortPointsByNode,
    colorMap,
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    portPointPairs: PortPointPair[]
    availablePortPointsByNode: Map<CapacityMeshNodeId, AvailablePortPoint[]>
    colorMap?: Record<string, string>
  }) {
    super()
    this.srj = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.portPointPairs = portPointPairs
    this.availablePortPointsByNode = availablePortPointsByNode
    this.colorMap = colorMap ?? {}

    this.nodeWithPortPoints = []
    this.nodePf = this.computeNodePf()
  }

  private computeNodePf() {
    const pfMap = new Map<CapacityMeshNodeId, number>()
    for (const node of this.nodes) {
      const segmentPoints: SegmentPoint[] = (
        this.availablePortPointsByNode.get(node.capacityMeshNodeId) ?? []
      ).map((pp, idx) => ({
        segmentPointId: `${node.capacityMeshNodeId}-${idx}`,
        directlyConnectedSegmentPointIds: [],
        connectionName: "__unused__",
        segmentId: pp.sharedEdgeId,
        capacityMeshNodeIds: [node.capacityMeshNodeId],
        x: pp.x,
        y: pp.y,
        z: pp.z,
      }))

      const crossings = getIntraNodeCrossingsFromSegmentPoints(segmentPoints)
      const pf = calculateNodeProbabilityOfFailure(
        node,
        crossings.numSameLayerCrossings,
        crossings.numEntryExitLayerChanges,
        crossings.numTransitionCrossings,
      )
      pfMap.set(node.capacityMeshNodeId, pf)
    }
    return pfMap
  }

  private findContainingNodeId(point: { x: number; y: number }) {
    const node = this.nodes.find((n) => isPointInsideNode(n, point.x, point.y))
    return node?.capacityMeshNodeId ?? null
  }

  private buildAdjacency() {
    const adjacency = new Map<CapacityMeshNodeId, CapacityMeshNodeId[]>()
    for (const edge of this.edges) {
      const [a, b] = edge.nodeIds
      adjacency.set(a, [...(adjacency.get(a) ?? []), b])
      adjacency.set(b, [...(adjacency.get(b) ?? []), a])
    }
    return adjacency
  }

  private computeNodeDistanceCost(fromId: string, toId: string) {
    const from = this.nodes.find((n) => n.capacityMeshNodeId === fromId)
    const to = this.nodes.find((n) => n.capacityMeshNodeId === toId)
    if (!from || !to) return Infinity

    const dist = distance(from.center, to.center)
    const pfPenalty = (this.nodePf.get(toId) ?? 0) * 50
    return dist + pfPenalty
  }

  private findNodePath(startId: string, endId: string) {
    const adjacency = this.buildAdjacency()
    const visited = new Set<CapacityMeshNodeId>()
    const queue: Array<{
      id: CapacityMeshNodeId
      cost: number
      path: string[]
    }> = [{ id: startId, cost: 0, path: [startId] }]

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost)
      const current = queue.shift()!
      if (visited.has(current.id)) continue
      visited.add(current.id)
      if (current.id === endId) return current.path

      for (const neighbor of adjacency.get(current.id) ?? []) {
        if (visited.has(neighbor)) continue
        const cost =
          current.cost + this.computeNodeDistanceCost(current.id, neighbor)
        queue.push({ id: neighbor, cost, path: [...current.path, neighbor] })
      }
    }

    return null
  }

  private choosePortPoint(
    fromNodeId: string,
    toNodeId: string,
  ): { a: AvailablePortPoint; b: AvailablePortPoint } | null {
    for (const pair of this.portPointPairs) {
      if (
        (pair.a.nodeId === fromNodeId && pair.b.nodeId === toNodeId) ||
        (pair.a.nodeId === toNodeId && pair.b.nodeId === fromNodeId)
      ) {
        return pair.a.nodeId === fromNodeId
          ? { a: pair.a, b: pair.b }
          : { a: pair.b, b: pair.a }
      }
    }
    return null
  }

  private registerPortPoint(
    map: Map<string, NodeWithPortPoints>,
    nodeId: string,
    pp: AvailablePortPoint,
    connectionName: string,
    rootConnectionName?: string,
  ) {
    const node = this.nodes.find((n) => n.capacityMeshNodeId === nodeId)!
    if (!map.has(nodeId)) {
      map.set(nodeId, {
        capacityMeshNodeId: nodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints: [],
        availableZ: node.availableZ,
      })
    }

    map.get(nodeId)!.portPoints.push({
      x: pp.x,
      y: pp.y,
      z: pp.z,
      connectionName,
      rootConnectionName,
      neighborNodeId: pp.neighborNodeId,
    })
  }

  _step() {
    const nodePortPointMap = new Map<string, NodeWithPortPoints>()

    for (const connection of this.srj.connections) {
      if (connection.pointsToConnect.length < 2) continue
      const startPt = connection.pointsToConnect[0]
      const endPt = connection.pointsToConnect[1]

      const startNodeId = this.findContainingNodeId(startPt)
      const endNodeId = this.findContainingNodeId(endPt)
      if (!startNodeId || !endNodeId) continue

      const path = this.findNodePath(startNodeId, endNodeId)
      if (!path) continue

      for (let i = 0; i < path.length - 1; i++) {
        const fromId = path[i]
        const toId = path[i + 1]
        const chosen = this.choosePortPoint(fromId, toId)
        if (!chosen) continue

        this.registerPortPoint(
          nodePortPointMap,
          fromId,
          chosen.a,
          connection.name,
          connection.netConnectionName,
        )
        this.registerPortPoint(
          nodePortPointMap,
          toId,
          chosen.b,
          connection.name,
          connection.netConnectionName,
        )
      }
    }

    this.nodeWithPortPoints = Array.from(nodePortPointMap.values())
    this.solved = true
  }

  getNodesWithPortPoints() {
    if (!this.solved) throw new Error("PortPointPathingSolver not solved yet")
    return this.nodeWithPortPoints
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      rects: [],
      circles: [],
    }

    for (const node of this.nodeWithPortPoints) {
      node.portPoints.forEach((pp) => {
        graphics.points!.push({
          x: pp.x,
          y: pp.y,
          label: `${node.capacityMeshNodeId}: ${pp.connectionName ?? "unused"}`,
          color: this.colorMap[pp.connectionName ?? ""] ?? "#000",
        })
      })

      const allPps = node.portPoints
      for (let i = 0; i < allPps.length; i++) {
        for (let j = i + 1; j < allPps.length; j++) {
          const a = allPps[i]
          const b = allPps[j]
          const line: Line = {
            points: [
              { x: a.x, y: a.y },
              { x: b.x, y: b.y },
            ],
            strokeDash: "4 6",
            strokeColor: "rgba(0,0,0,0.15)",
          }
          graphics.lines!.push(line)
        }
      }
    }

    return graphics
  }
}
