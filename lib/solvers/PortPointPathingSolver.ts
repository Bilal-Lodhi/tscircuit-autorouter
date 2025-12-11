import { BaseSolver } from "./BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteJson,
} from "lib/types"
import { AvailableSegmentPoint } from "./AvailableSegmentPointSolver"
import { calculateNodeProbabilityOfFailure } from "./UnravelSolver/calculateCrossingProbabilityOfFailure"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

interface GraphEdge {
  target: string
  weight: number
}

export class PortPointPathingSolver extends BaseSolver {
  connections: SimpleRouteJson["connections"]
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  availableSegmentPoints: AvailableSegmentPoint[]
  colorMap: Record<string, string>

  nodeMap: Map<string, CapacityMeshNode>
  adjacency: Map<string, GraphEdge[]> = new Map()
  usedPortPoints: Map<string, PortPoint[]> = new Map()

  constructor({
    simpleRouteJson,
    nodes,
    edges,
    availableSegmentPoints,
    colorMap,
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    availableSegmentPoints: AvailableSegmentPoint[]
    colorMap?: Record<string, string>
  }) {
    super()
    this.connections = simpleRouteJson.connections
    this.nodes = nodes
    this.edges = edges
    this.availableSegmentPoints = availableSegmentPoints
    this.colorMap = colorMap ?? {}
    this.nodeMap = new Map(nodes.map((n) => [n.capacityMeshNodeId, n]))
    this.MAX_ITERATIONS = 10_000
    this.buildAdjacency()
  }

  buildAdjacency() {
    const pointsByNode = new Map<string, AvailableSegmentPoint[]>()
    for (const pt of this.availableSegmentPoints) {
      if (!pointsByNode.has(pt.nodeId)) pointsByNode.set(pt.nodeId, [])
      pointsByNode.get(pt.nodeId)!.push(pt)
    }

    for (const pt of this.availableSegmentPoints) {
      const neighbors: GraphEdge[] = []

      // Connect to partner across edge
      const partner = this.availableSegmentPoints.find(
        (p) => p.id === pt.partnerId,
      )
      if (partner) {
        neighbors.push({
          target: partner.id,
          weight: 0.001,
        })
      }

      // Connect to other points within node
      const siblings = pointsByNode.get(pt.nodeId) ?? []
      const node = this.nodeMap.get(pt.nodeId)
      for (const sibling of siblings) {
        if (sibling.id === pt.id) continue
        const distance = Math.hypot(sibling.x - pt.x, sibling.y - pt.y)
        const entryExitLayerChanges = sibling.z === pt.z ? 0 : 1
        const transitionCrossings = entryExitLayerChanges
        const pf = node
          ? calculateNodeProbabilityOfFailure(
              node,
              0,
              entryExitLayerChanges,
              transitionCrossings,
            )
          : 0
        const weight = distance + pf
        neighbors.push({ target: sibling.id, weight })
      }

      this.adjacency.set(pt.id, neighbors)
    }
  }

  _step() {
    for (const connection of this.connections) {
      const targetNodes = this.nodes.filter(
        (n) => n._targetConnectionName === connection.name,
      )
      if (targetNodes.length < 2) continue
      const [startNode, endNode] = targetNodes

      const startPoints = this.availableSegmentPoints.filter(
        (pt) => pt.nodeId === startNode.capacityMeshNodeId,
      )
      const endPoints = this.availableSegmentPoints.filter(
        (pt) => pt.nodeId === endNode.capacityMeshNodeId,
      )

      if (startPoints.length === 0 || endPoints.length === 0) continue

      const { path } = shortestPath(
        this.adjacency,
        startPoints.map((p) => p.id),
        new Set(endPoints.map((p) => p.id)),
      )
      if (!path) continue

      for (const pointId of path) {
        const point = this.availableSegmentPoints.find((p) => p.id === pointId)
        if (!point) continue
        if (!this.usedPortPoints.has(point.nodeId)) {
          const node = this.nodeMap.get(point.nodeId)!
          this.usedPortPoints.set(point.nodeId, [
            {
              x: node.center.x,
              y: node.center.y,
              z: point.z,
              connectionName: connection.name,
            },
          ])
        }
        this.usedPortPoints.get(point.nodeId)!.push({
          x: point.x,
          y: point.y,
          z: point.z,
          connectionName: connection.name,
          rootConnectionName: connection.netConnectionName,
        })
      }
    }

    this.solved = true
  }

  getNodesWithPortPoints(): NodeWithPortPoints[] {
    if (!this.solved) {
      throw new Error("PortPointPathingSolver not solved")
    }

    return this.nodes.map((node) => ({
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: this.usedPortPoints.get(node.capacityMeshNodeId) ?? [],
      availableZ: node.availableZ,
    }))
  }
}

function shortestPath(
  adjacency: Map<string, GraphEdge[]>,
  startIds: string[],
  goalIds: Set<string>,
): { path: string[] | null } {
  const distances = new Map<string, number>()
  const previous = new Map<string, string | null>()
  const queue = new Set<string>()

  for (const start of startIds) {
    distances.set(start, 0)
    previous.set(start, null)
    queue.add(start)
  }

  const getMin = () => {
    let minId: string | null = null
    let minDist = Infinity
    for (const id of queue) {
      const dist = distances.get(id) ?? Infinity
      if (dist < minDist) {
        minDist = dist
        minId = id
      }
    }
    return { minId, minDist }
  }

  while (queue.size > 0) {
    const { minId } = getMin()
    if (!minId) break
    queue.delete(minId)

    if (goalIds.has(minId)) {
      const path = []
      let current: string | null = minId
      while (current) {
        path.unshift(current)
        current = previous.get(current) ?? null
      }
      return { path }
    }

    const neighbors = adjacency.get(minId) ?? []
    for (const { target, weight } of neighbors) {
      const alt = (distances.get(minId) ?? Infinity) + weight
      if (alt < (distances.get(target) ?? Infinity)) {
        distances.set(target, alt)
        previous.set(target, minId)
        queue.add(target)
      }
    }
  }

  return { path: null }
}
