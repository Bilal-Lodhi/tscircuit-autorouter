import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject, Line } from "graphics-debug"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"
import { distance } from "@tscircuit/math-utils"
import {
  AvailableSegmentPointSolver,
  SegmentPortPoint,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { getTunedTotalCapacity1 } from "../../utils/getTunedTotalCapacity1"
import { NodeWithPortPoints, PortPoint } from "../../types/high-density-types"
import { safeTransparentize } from "../colors"

export interface PathingCandidate {
  prevCandidate: PathingCandidate | null
  node: CapacityMeshNode
  entryPortPoint: SegmentPortPoint | null
  f: number
  g: number
  h: number
}

export interface ConnectionPathResult {
  connection: SimpleRouteConnection
  nodes: CapacityMeshNode[]
  path?: CapacityMeshNode[]
  portPoints?: SegmentPortPoint[]
  straightLineDistance: number
}

/**
 * PortPointPathingSolver finds paths through the capacity mesh using
 * pre-computed port points on shared edges. It considers layer information
 * when routing and uses a probability-of-failure based cost function
 * similar to the UnravelSolver.
 *
 * Key differences from the old pathing approach:
 * 1. Routes through explicit port points on node edges
 * 2. Considers layer compatibility when selecting paths
 * 3. Uses pf-based cost function that considers crossings and via potential
 */
export class PortPointPathingSolver extends BaseSolver {
  simpleRouteJson: SimpleRouteJson
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>

  segmentPointSolver: AvailableSegmentPointSolver
  connectionsWithResults: ConnectionPathResult[] = []

  /** Tracks how many traces pass through each node */
  nodeTraceCountMap: Map<CapacityMeshNodeId, number>

  /** Tracks traces by layer for each node to estimate crossings */
  nodeLayerTraceCount: Map<CapacityMeshNodeId, Map<number, number>>

  colorMap: Record<string, string>
  maxDepthOfNodes: number

  GREEDY_MULTIPLIER = 2.5
  MAX_CANDIDATES_IN_MEMORY = 50_000

  // Current pathing state
  currentConnectionIndex = 0
  candidates?: PathingCandidate[] | null
  visitedNodes?: Set<CapacityMeshNodeId> | null
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>

  constructor({
    simpleRouteJson,
    nodes,
    edges,
    segmentPointSolver,
    colorMap,
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    segmentPointSolver: AvailableSegmentPointSolver
    colorMap?: Record<string, string>
  }) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.simpleRouteJson = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.segmentPointSolver = segmentPointSolver
    this.colorMap = colorMap ?? {}

    this.nodeMap = new Map(nodes.map((n) => [n.capacityMeshNodeId, n]))
    this.nodeEdgeMap = getNodeEdgeMap(edges)

    this.nodeTraceCountMap = new Map(
      nodes.map((n) => [n.capacityMeshNodeId, 0]),
    )
    this.nodeLayerTraceCount = new Map(
      nodes.map((n) => [n.capacityMeshNodeId, new Map()]),
    )

    this.maxDepthOfNodes = Math.max(...nodes.map((n) => n._depth ?? 0))

    const { connectionsWithResults, connectionNameToGoalNodeIds } =
      this.getConnectionsWithNodes()
    this.connectionsWithResults = connectionsWithResults
    this.connectionNameToGoalNodeIds = connectionNameToGoalNodeIds
  }

  private getConnectionsWithNodes() {
    const connectionsWithResults: ConnectionPathResult[] = []
    const nodesWithTargets = this.nodes.filter((n) => n._containsTarget)
    const connectionNameToGoalNodeIds = new Map<string, CapacityMeshNodeId[]>()

    for (const connection of this.simpleRouteJson.connections) {
      const nodesForConnection: CapacityMeshNode[] = []

      for (const point of connection.pointsToConnect) {
        let closestNode = this.nodes[0]
        let minDistance = Number.MAX_VALUE

        for (const node of nodesWithTargets) {
          const dist = Math.sqrt(
            (node.center.x - point.x) ** 2 + (node.center.y - point.y) ** 2,
          )
          if (dist < minDistance) {
            minDistance = dist
            closestNode = node
          }
        }
        nodesForConnection.push(closestNode)
      }

      if (nodesForConnection.length < 2) {
        throw new Error(
          `Not enough nodes for connection "${connection.name}", only ${nodesForConnection.length} found`,
        )
      }

      connectionNameToGoalNodeIds.set(
        connection.name,
        nodesForConnection.map((n) => n.capacityMeshNodeId),
      )

      connectionsWithResults.push({
        connection,
        nodes: nodesForConnection,
        straightLineDistance: distance(
          nodesForConnection[0].center,
          nodesForConnection[nodesForConnection.length - 1].center,
        ),
      })
    }

    // Sort by straight-line distance (shorter first)
    connectionsWithResults.sort(
      (a, b) => a.straightLineDistance - b.straightLineDistance,
    )

    return { connectionsWithResults, connectionNameToGoalNodeIds }
  }

  private getTotalCapacity(node: CapacityMeshNode): number {
    return getTunedTotalCapacity1(node)
  }

  /**
   * Compute probability of failure for a node based on trace counts.
   * Similar to calculateNodeProbabilityOfFailure in UnravelSolver.
   */
  private computeNodePf(node: CapacityMeshNode): number {
    if (node._containsTarget) return 0

    const totalCapacity = this.getTotalCapacity(node)
    const traceCount = this.nodeTraceCountMap.get(node.capacityMeshNodeId) ?? 0
    const layerCounts =
      this.nodeLayerTraceCount.get(node.capacityMeshNodeId) ?? new Map()

    // Estimate crossings based on trace distribution across layers
    let estimatedSameLayerCrossings = 0
    for (const [_layer, count] of layerCounts) {
      // Crossings scale roughly quadratically with traces on same layer
      if (count > 1) {
        estimatedSameLayerCrossings += (count * (count - 1)) / 4
      }
    }

    // Estimate layer transitions - traces that need to change layers
    const numLayers = node.availableZ.length
    const estimatedLayerChanges =
      numLayers > 1 ? traceCount * 0.3 : traceCount * 0.8

    // Calculate estimated via count
    const estNumVias =
      estimatedSameLayerCrossings * 0.82 + estimatedLayerChanges * 0.41

    const estUsedCapacity = (estNumVias / 2) ** 1.1
    return estUsedCapacity / totalCapacity
  }

  /**
   * Cost penalty based on node probability of failure
   */
  private getNodePfPenalty(node: CapacityMeshNode): number {
    const pf = this.computeNodePf(node)
    const basePenalty = 0.05

    // Exponential penalty as pf increases
    if (pf < 0.1) return basePenalty
    if (pf < 0.3) return basePenalty + pf * (node.width + node.height) * 0.5
    if (pf < 0.6) return basePenalty + pf * (node.width + node.height) * 1.5
    return basePenalty + pf * (node.width + node.height) * 4
  }

  /**
   * Penalty for using an edge based on port point availability
   */
  private getEdgeCapacityPenalty(
    fromNode: CapacityMeshNode,
    toNode: CapacityMeshNode,
  ): number {
    const availableCount = this.segmentPointSolver.getAvailablePortCountForEdge(
      fromNode.capacityMeshNodeId,
      toNode.capacityMeshNodeId,
    )

    if (availableCount === 0) return 1000 // No ports available
    if (availableCount === 1) return 5 // Last port available
    if (availableCount === 2) return 1 // Getting tight
    return 0
  }

  private getDistanceBetweenNodes(A: CapacityMeshNode, B: CapacityMeshNode) {
    return Math.sqrt(
      (A.center.x - B.center.x) ** 2 + (A.center.y - B.center.y) ** 2,
    )
  }

  private computeG(
    prevCandidate: PathingCandidate,
    node: CapacityMeshNode,
  ): number {
    const distanceCost = this.getDistanceBetweenNodes(prevCandidate.node, node)
    const pfPenalty = this.getNodePfPenalty(node)
    const edgePenalty = this.getEdgeCapacityPenalty(prevCandidate.node, node)

    return prevCandidate.g + distanceCost + pfPenalty + edgePenalty
  }

  private computeH(node: CapacityMeshNode, endGoal: CapacityMeshNode): number {
    return this.getDistanceBetweenNodes(node, endGoal)
  }

  private getNeighboringNodes(node: CapacityMeshNode): CapacityMeshNode[] {
    const edges = this.nodeEdgeMap.get(node.capacityMeshNodeId) ?? []
    return edges
      .flatMap((edge) =>
        edge.nodeIds.filter((id) => id !== node.capacityMeshNodeId),
      )
      .map((id) => this.nodeMap.get(id)!)
      .filter(Boolean)
  }

  private doesNodeHaveCapacity(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode,
  ): boolean {
    // Match the original CapacityPathingGreedySolver behavior:
    // Always return true - use soft penalties instead of hard blocking
    // This ensures we can always find a path if one exists
    return true
  }

  private canTravelThroughObstacle(
    node: CapacityMeshNode,
    connectionName: string,
  ): boolean {
    const goalNodeIds = this.connectionNameToGoalNodeIds.get(connectionName)
    return goalNodeIds?.includes(node.capacityMeshNodeId) ?? false
  }

  private isConnectedToEndGoal(
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ): boolean {
    const edges = this.nodeEdgeMap.get(node.capacityMeshNodeId) ?? []
    return edges.some((edge) =>
      edge.nodeIds.includes(endGoal.capacityMeshNodeId),
    )
  }

  private getBacktrackedPath(candidate: PathingCandidate): CapacityMeshNode[] {
    const path: CapacityMeshNode[] = []
    let current: PathingCandidate | null = candidate
    while (current) {
      path.push(current.node)
      current = current.prevCandidate
    }
    return path.reverse()
  }

  /**
   * Assign port points along a path and record which connections use them.
   * Returns an array with one entry per edge (path.length - 1 entries).
   * If no port point is available on an edge, generates a synthetic one at the edge center.
   */
  private assignPortPointsForPath(
    path: CapacityMeshNode[],
    connectionName: string,
    rootConnectionName?: string,
  ): SegmentPortPoint[] {
    const assignedPortPoints: SegmentPortPoint[] = []

    for (let i = 0; i < path.length - 1; i++) {
      const fromNode = path[i]
      const toNode = path[i + 1]

      const availablePoints =
        this.segmentPointSolver.getAvailablePortPointsBetweenNodes(
          fromNode.capacityMeshNodeId,
          toNode.capacityMeshNodeId,
        )

      if (availablePoints.length > 0) {
        // Pick the first available port point
        const portPoint = availablePoints[0]
        this.segmentPointSolver.assignPortPoint(
          portPoint.segmentPortPointId,
          connectionName,
          rootConnectionName,
        )
        assignedPortPoints.push(portPoint)
      } else {
        // No available port points - create a synthetic one at the edge midpoint
        // This ensures we always have a port point for each edge
        const allPortPoints = this.segmentPointSolver.getPortPointsForEdge(
          fromNode.capacityMeshNodeId,
          toNode.capacityMeshNodeId,
        )

        if (allPortPoints.length > 0) {
          // Reuse an existing port point location (may be used by another connection)
          const portPoint = allPortPoints[0]
          assignedPortPoints.push({
            ...portPoint,
            connectionName,
            rootConnectionName,
          })
        } else {
          // No port points at all for this edge - compute a synthetic midpoint
          const midX = (fromNode.center.x + toNode.center.x) / 2
          const midY = (fromNode.center.y + toNode.center.y) / 2
          const availableZ = fromNode.availableZ.filter((z) =>
            toNode.availableZ.includes(z),
          )

          assignedPortPoints.push({
            segmentPortPointId: `synthetic_${fromNode.capacityMeshNodeId}_${toNode.capacityMeshNodeId}_${connectionName}`,
            x: midX,
            y: midY,
            availableZ: availableZ.length > 0 ? availableZ : [0],
            nodeIds: [fromNode.capacityMeshNodeId, toNode.capacityMeshNodeId],
            edgeId: `synthetic_edge_${fromNode.capacityMeshNodeId}_${toNode.capacityMeshNodeId}`,
            connectionName,
            rootConnectionName,
          })
        }
      }
    }

    return assignedPortPoints
  }

  /**
   * Update trace counts for nodes in a path
   */
  private updateTraceCountsForPath(
    path: CapacityMeshNode[],
    preferredZ?: number,
  ) {
    const z = preferredZ ?? 0

    for (const node of path) {
      const currentCount =
        this.nodeTraceCountMap.get(node.capacityMeshNodeId) ?? 0
      this.nodeTraceCountMap.set(node.capacityMeshNodeId, currentCount + 1)

      const layerCounts =
        this.nodeLayerTraceCount.get(node.capacityMeshNodeId) ?? new Map()
      layerCounts.set(z, (layerCounts.get(z) ?? 0) + 1)
    }
  }

  _step() {
    const nextConnection =
      this.connectionsWithResults[this.currentConnectionIndex]
    if (!nextConnection) {
      this.solved = true
      return
    }

    const [start, end] = nextConnection.nodes

    if (!this.candidates) {
      this.candidates = [
        {
          prevCandidate: null,
          node: start,
          entryPortPoint: null,
          f: 0,
          g: 0,
          h: 0,
        },
      ]
      this.visitedNodes = new Set([start.capacityMeshNodeId])
    }

    // Sort candidates by f value
    this.candidates.sort((a, b) => a.f - b.f)
    const currentCandidate = this.candidates.shift()

    // Limit memory usage
    if (this.candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }

    if (!currentCandidate) {
      console.error(
        `Ran out of candidates on connection ${nextConnection.connection.name}`,
      )
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      this.failed = true
      return
    }

    // Check if we reached the goal
    if (this.isConnectedToEndGoal(currentCandidate.node, end)) {
      const path = this.getBacktrackedPath({
        prevCandidate: currentCandidate,
        node: end,
        entryPortPoint: null,
        f: 0,
        g: 0,
        h: 0,
      })

      nextConnection.path = path
      nextConnection.portPoints = this.assignPortPointsForPath(
        path,
        nextConnection.connection.name,
        nextConnection.connection.rootConnectionName,
      )

      this.updateTraceCountsForPath(path)

      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      return
    }

    // Expand neighbors
    const neighbors = this.getNeighboringNodes(currentCandidate.node)
    for (const neighbor of neighbors) {
      if (this.visitedNodes?.has(neighbor.capacityMeshNodeId)) continue
      if (!this.doesNodeHaveCapacity(neighbor, currentCandidate.node)) continue

      const connectionName = nextConnection.connection.name
      if (
        neighbor._containsObstacle &&
        !this.canTravelThroughObstacle(neighbor, connectionName)
      ) {
        continue
      }

      const g = this.computeG(currentCandidate, neighbor)
      const h = this.computeH(neighbor, end)
      const f = g + h * this.GREEDY_MULTIPLIER

      this.candidates.push({
        prevCandidate: currentCandidate,
        node: neighbor,
        entryPortPoint: null,
        f,
        g,
        h,
      })
    }

    this.visitedNodes!.add(currentCandidate.node.capacityMeshNodeId)
  }

  /**
   * Get the nodes with port points for the HighDensitySolver
   *
   * For each connection passing through a node, it needs exactly 2 port points:
   * - For intermediate nodes: entry port point + exit port point
   * - For start node: target point + exit port point
   * - For end node: entry port point + target point
   */
  getNodesWithPortPoints(): NodeWithPortPoints[] {
    const nodePortPointsMap = new Map<CapacityMeshNodeId, NodeWithPortPoints>()

    // Helper to ensure node exists in map
    const ensureNode = (nodeId: CapacityMeshNodeId) => {
      if (!nodePortPointsMap.has(nodeId)) {
        const node = this.nodeMap.get(nodeId)
        if (node) {
          nodePortPointsMap.set(nodeId, {
            capacityMeshNodeId: nodeId,
            center: node.center,
            width: node.width,
            height: node.height,
            portPoints: [],
            availableZ: node.availableZ,
          })
        }
      }
      return nodePortPointsMap.get(nodeId)
    }

    // Build a map from (nodeId, connectionName) -> list of port points
    // This will help us collect all port points for a connection in a node
    const nodeConnectionPortPoints = new Map<
      string,
      Array<{ x: number; y: number; z: number }>
    >()

    const addPortPoint = (
      nodeId: CapacityMeshNodeId,
      connectionName: string,
      point: { x: number; y: number; z: number },
    ) => {
      const key = `${nodeId}::${connectionName}`
      if (!nodeConnectionPortPoints.has(key)) {
        nodeConnectionPortPoints.set(key, [])
      }
      nodeConnectionPortPoints.get(key)!.push(point)
    }

    // Process each solved connection
    for (const result of this.connectionsWithResults) {
      if (!result.path || result.path.length === 0) continue

      const connection = result.connection
      const path = result.path
      const portPoints = result.portPoints ?? []

      // Add target points (start and end connection points)
      const startNode = path[0]
      const endNode = path[path.length - 1]
      const startPoint = connection.pointsToConnect[0]
      const endPoint =
        connection.pointsToConnect[connection.pointsToConnect.length - 1]

      if (startPoint && startNode) {
        const z = startNode.availableZ[0] ?? 0
        addPortPoint(startNode.capacityMeshNodeId, connection.name, {
          x: startPoint.x,
          y: startPoint.y,
          z,
        })
      }

      if (endPoint && endNode) {
        const z = endNode.availableZ[0] ?? 0
        addPortPoint(endNode.capacityMeshNodeId, connection.name, {
          x: endPoint.x,
          y: endPoint.y,
          z,
        })
      }

      // Add port points to both adjacent nodes for each edge
      for (let i = 0; i < portPoints.length; i++) {
        const portPoint = portPoints[i]
        if (!portPoint) continue

        // This port point is on the edge between path[i] and path[i+1]
        // It should be added to both nodes
        const nodeA = path[i]
        const nodeB = path[i + 1]

        if (nodeA && nodeB) {
          const z = portPoint.availableZ[0] ?? 0
          addPortPoint(nodeA.capacityMeshNodeId, connection.name, {
            x: portPoint.x,
            y: portPoint.y,
            z,
          })
          addPortPoint(nodeB.capacityMeshNodeId, connection.name, {
            x: portPoint.x,
            y: portPoint.y,
            z,
          })
        }
      }
    }

    // Convert to NodeWithPortPoints format
    for (const [key, points] of nodeConnectionPortPoints) {
      const [nodeId, connectionName] = key.split("::")
      const nodeWithPP = ensureNode(nodeId)
      if (!nodeWithPP) continue

      // Find the connection to get rootConnectionName
      const result = this.connectionsWithResults.find(
        (r) => r.connection.name === connectionName,
      )
      const rootConnectionName = result?.connection.rootConnectionName

      for (const point of points) {
        nodeWithPP.portPoints.push({
          x: point.x,
          y: point.y,
          z: point.z,
          connectionName: connectionName,
          rootConnectionName,
        })
      }
    }

    return Array.from(nodePortPointsMap.values()).filter(
      (n) => n.portPoints.length > 0,
    )
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw nodes with pf coloring
    for (const node of this.nodes) {
      const pf = this.computeNodePf(node)
      const red = Math.min(255, Math.floor(pf * 512))
      const green = Math.max(0, 255 - Math.floor(pf * 512))
      const color = `rgba(${red}, ${green}, 0, 0.3)`

      graphics.rects!.push({
        center: node.center,
        width: node.width * 0.9,
        height: node.height * 0.9,
        fill: color,
        label: `${node.capacityMeshNodeId}\npf: ${pf.toFixed(3)}`,
      })
    }

    // Draw solved paths using port points
    for (const result of this.connectionsWithResults) {
      if (!result.path || !result.portPoints) continue

      const connection = result.connection
      const color = this.colorMap[connection.name] ?? "blue"

      // Build path points: start point -> port points -> end point
      const pathPoints: Array<{ x: number; y: number }> = []

      // Add start point (first connection point)
      const startPoint = connection.pointsToConnect[0]
      if (startPoint) {
        pathPoints.push({ x: startPoint.x, y: startPoint.y })
      }

      // Add port points in order
      for (const portPoint of result.portPoints) {
        pathPoints.push({ x: portPoint.x, y: portPoint.y })
      }

      // Add end point (last connection point)
      const endPoint =
        connection.pointsToConnect[connection.pointsToConnect.length - 1]
      if (endPoint) {
        pathPoints.push({ x: endPoint.x, y: endPoint.y })
      }

      if (pathPoints.length >= 2) {
        graphics.lines!.push({
          points: pathPoints,
          strokeColor: color,
        })
      }
    }

    // Draw segment point solver visualization
    const segmentViz = this.segmentPointSolver.visualize()
    if (segmentViz.circles) graphics.circles!.push(...segmentViz.circles)
    if (segmentViz.lines) graphics.lines!.push(...segmentViz.lines)

    // While actively solving, draw the top 10 most promising candidates
    if (!this.solved && this.candidates && this.candidates.length > 0) {
      const currentConnection =
        this.connectionsWithResults[this.currentConnectionIndex]
      const connectionColor = currentConnection
        ? (this.colorMap[currentConnection.connection.name] ?? "blue")
        : "blue"

      // Sort candidates by f value and take top 10
      const sortedCandidates = [...this.candidates]
        .sort((a, b) => a.f - b.f)
        .slice(0, 10)

      for (const candidate of sortedCandidates) {
        // Build the path from this candidate back to start
        const candidatePath: Array<{ x: number; y: number }> = []
        let current: PathingCandidate | null = candidate
        while (current) {
          candidatePath.unshift({
            x: current.node.center.x,
            y: current.node.center.y,
          })
          current = current.prevCandidate
        }

        if (candidatePath.length >= 1) {
          graphics.lines!.push({
            points: candidatePath,
            strokeColor: safeTransparentize(connectionColor, 0.25),
          })

          // Draw a circle at the head of each candidate to show where exploration is
          const head = candidatePath[candidatePath.length - 1]
          graphics.circles!.push({
            center: head,
            radius: Math.min(candidate.node.height, candidate.node.width) * 0.1,
            fill: safeTransparentize(connectionColor, 0.25),
          })
        }
      }
    }

    return graphics
  }
}
