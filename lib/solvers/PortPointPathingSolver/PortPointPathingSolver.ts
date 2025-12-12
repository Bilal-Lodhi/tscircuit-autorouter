import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"
import { distance } from "@tscircuit/math-utils"
import type { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { getTunedTotalCapacity1 } from "../../utils/getTunedTotalCapacity1"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import type { PortPoint } from "../../types/high-density-types"
import { NodeWithPortPoints } from "../../types/high-density-types"
import { safeTransparentize } from "../colors"

export interface PathingCandidate {
  prevCandidate: PathingCandidate | null
  node: CapacityMeshNode
  entryPortPoint: SegmentPortPoint | null
  /** The point coordinates used to enter this candidate (for point-to-point distance) */
  entryPoint: { x: number; y: number } | null
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

  connectionsWithResults: ConnectionPathResult[] = []

  /** Tracks port points assigned to each node for crossing calculations */
  nodePortPointsMap: Map<CapacityMeshNodeId, PortPoint[]> = new Map()

  /** Tracks how many times each port point has been used */
  portPointUsageCount: Map<string, number> = new Map()

  /** Factor applied to port point reuse penalty */
  NODE_REUSE_FACTOR = 1.0

  /** Multiplied by Pf**2 to get node probability penalty */
  NODE_PF_FACTOR = 0.0

  /** Cost of adding a candidate to the path (penalizes long paths or useless candidates) */
  BASE_CANDIDATE_COST = 0.25

  colorMap: Record<string, string>
  maxDepthOfNodes: number

  GREEDY_MULTIPLIER = 1
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
    colorMap,
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    colorMap?: Record<string, string>
  }) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.simpleRouteJson = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.colorMap = colorMap ?? {}

    this.nodeMap = new Map(nodes.map((n) => [n.capacityMeshNodeId, n]))
    this.nodeEdgeMap = getNodeEdgeMap(edges)

    // Initialize empty port points array for each node
    this.nodePortPointsMap = new Map(
      nodes.map((n) => [n.capacityMeshNodeId, []]),
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
   * Build a NodeWithPortPoints structure for crossing calculation.
   * Optionally includes additional port points for "what if" scenario.
   */
  private buildNodeWithPortPoints(
    node: CapacityMeshNode,
    additionalPortPoints?: PortPoint[],
  ): NodeWithPortPoints {
    const existingPortPoints =
      this.nodePortPointsMap.get(node.capacityMeshNodeId) ?? []
    const allPortPoints = additionalPortPoints
      ? [...existingPortPoints, ...additionalPortPoints]
      : existingPortPoints

    return {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: allPortPoints,
      availableZ: node.availableZ,
    }
  }

  /**
   * Compute probability of failure for a node using getIntraNodeCrossings.
   * Uses calculateNodeProbabilityOfFailure from UnravelSolver.
   *
   * @param node The node to compute pf for
   * @param additionalPortPoints Optional port points for "what if" scenario (entry and exit points for a new trace)
   */
  private computeNodePf(
    node: CapacityMeshNode,
    additionalPortPoints?: PortPoint[],
  ): number {
    if (node._containsTarget) return 0

    const nodeWithPortPoints = this.buildNodeWithPortPoints(
      node,
      additionalPortPoints,
    )
    const crossings = getIntraNodeCrossings(nodeWithPortPoints)

    return calculateNodeProbabilityOfFailure(
      node,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  /**
   * Cost penalty based on node probability of failure.
   *
   * @param node The node to compute penalty for
   * @param additionalPortPoints Optional port points for "what if" scenario
   */
  private getNodePfPenalty(
    node: CapacityMeshNode,
    additionalPortPoints?: PortPoint[],
  ): number {
    const pf = this.computeNodePf(node, additionalPortPoints)
    return pf ** 2 * this.NODE_PF_FACTOR
  }

  /**
   * Get a unique key for an edge between two nodes (order-independent)
   */
  private getEdgeKey(
    nodeId1: CapacityMeshNodeId,
    nodeId2: CapacityMeshNodeId,
  ): string {
    return nodeId1 < nodeId2 ? `${nodeId1}:${nodeId2}` : `${nodeId2}:${nodeId1}`
  }

  private getReusePenalty(
    fromNode: CapacityMeshNode,
    toNode: CapacityMeshNode,
  ): number {
    const edgeKey = this.getEdgeKey(
      fromNode.capacityMeshNodeId,
      toNode.capacityMeshNodeId,
    )
    const usageCount = this.portPointUsageCount.get(edgeKey) ?? 0
    return usageCount ** 2 * this.NODE_REUSE_FACTOR
  }

  private getDistanceBetweenPoints(
    A: { x: number; y: number },
    B: { x: number; y: number },
  ): number {
    return Math.sqrt((A.x - B.x) ** 2 + (A.y - B.y) ** 2)
  }

  /**
   * Get the exit point for a candidate when moving to a neighbor node.
   * Uses the midpoint of the shared edge between the two nodes.
   */
  private getExitPointToNeighbor(
    fromNode: CapacityMeshNode,
    toNode: CapacityMeshNode,
  ): { x: number; y: number } {
    // Find the midpoint of the shared edge between the two nodes
    const fromLeft = fromNode.center.x - fromNode.width / 2
    const fromRight = fromNode.center.x + fromNode.width / 2
    const fromTop = fromNode.center.y - fromNode.height / 2
    const fromBottom = fromNode.center.y + fromNode.height / 2

    const toLeft = toNode.center.x - toNode.width / 2
    const toRight = toNode.center.x + toNode.width / 2
    const toTop = toNode.center.y - toNode.height / 2
    const toBottom = toNode.center.y + toNode.height / 2

    // Check if they share a vertical edge (horizontally adjacent)
    if (Math.abs(fromRight - toLeft) < 0.001) {
      // from is to the left of to
      const y = (Math.max(fromTop, toTop) + Math.min(fromBottom, toBottom)) / 2
      return { x: fromRight, y }
    }
    if (Math.abs(fromLeft - toRight) < 0.001) {
      // from is to the right of to
      const y = (Math.max(fromTop, toTop) + Math.min(fromBottom, toBottom)) / 2
      return { x: fromLeft, y }
    }

    // Check if they share a horizontal edge (vertically adjacent)
    if (Math.abs(fromBottom - toTop) < 0.001) {
      // from is above to
      const x = (Math.max(fromLeft, toLeft) + Math.min(fromRight, toRight)) / 2
      return { x, y: fromBottom }
    }
    if (Math.abs(fromTop - toBottom) < 0.001) {
      // from is below to
      const x = (Math.max(fromLeft, toLeft) + Math.min(fromRight, toRight)) / 2
      return { x, y: fromTop }
    }

    // Fallback to midpoint between centers
    return {
      x: (fromNode.center.x + toNode.center.x) / 2,
      y: (fromNode.center.y + toNode.center.y) / 2,
    }
  }

  private computeG(
    prevCandidate: PathingCandidate,
    node: CapacityMeshNode,
    exitPoint: { x: number; y: number },
    connectionName: string,
  ): number {
    // Use point-to-point distance from the previous entry point to the new exit point
    const prevPoint = prevCandidate.entryPoint ?? prevCandidate.node.center
    const distanceCost = this.getDistanceBetweenPoints(prevPoint, exitPoint)

    // Determine the Z layer for the new trace (use mutual available Z, prefer first)
    const mutualZ = prevCandidate.node.availableZ.filter((z: number) =>
      node.availableZ.includes(z),
    )
    const traceZ = mutualZ.length > 0 ? mutualZ[0] : (node.availableZ[0] ?? 0)

    // Create hypothetical port points for this trace passing through the node
    // Entry point is the exitPoint from the previous node, exit point is the exitPoint to the next node
    const entryPortPoint: PortPoint = {
      x: prevPoint.x,
      y: prevPoint.y,
      z: traceZ,
      connectionName,
    }
    const exitPortPoint: PortPoint = {
      x: exitPoint.x,
      y: exitPoint.y,
      z: traceZ,
      connectionName,
    }

    // Compute pf penalty considering adding this new trace with its port points
    const pfPenalty = this.getNodePfPenalty(node, [
      entryPortPoint,
      exitPortPoint,
    ])
    const edgePenalty = this.getReusePenalty(prevCandidate.node, node)

    return (
      prevCandidate.g +
      this.BASE_CANDIDATE_COST +
      distanceCost +
      pfPenalty +
      edgePenalty
    )
  }

  private computeH(
    exitPoint: { x: number; y: number },
    endGoal: CapacityMeshNode,
  ): number {
    return this.getDistanceBetweenPoints(exitPoint, endGoal.center)
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
    _node: CapacityMeshNode,
    _prevNode: CapacityMeshNode,
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
   * Creates port points at the midpoint of each shared edge.
   * Also adds port points to nodePortPointsMap for crossing calculations.
   */
  private assignPortPointsForPath(
    path: CapacityMeshNode[],
    connectionName: string,
    rootConnectionName?: string,
  ): SegmentPortPoint[] {
    const assignedPortPoints: SegmentPortPoint[] = []
    let preferredZ: number | null = null

    for (let i = 0; i < path.length - 1; i++) {
      const fromNode = path[i]
      const toNode = path[i + 1]

      // Get the edge key and increment usage count
      const edgeKey = this.getEdgeKey(
        fromNode.capacityMeshNodeId,
        toNode.capacityMeshNodeId,
      )
      const currentUsage = this.portPointUsageCount.get(edgeKey) ?? 0
      this.portPointUsageCount.set(edgeKey, currentUsage + 1)

      // Compute the midpoint of the shared edge
      const exitPoint = this.getExitPointToNeighbor(fromNode, toNode)

      // Determine available Z layers (mutual between both nodes)
      const mutualZ = fromNode.availableZ.filter((z: number) =>
        toNode.availableZ.includes(z),
      )

      // Use preferred layer if available, otherwise first mutual layer
      const singleZ: number =
        preferredZ !== null && mutualZ.includes(preferredZ)
          ? preferredZ
          : mutualZ.length > 0
            ? mutualZ[0]
            : 0

      assignedPortPoints.push({
        segmentPortPointId: `pp_${fromNode.capacityMeshNodeId}_${toNode.capacityMeshNodeId}_${connectionName}`,
        x: exitPoint.x,
        y: exitPoint.y,
        availableZ: [singleZ],
        nodeIds: [fromNode.capacityMeshNodeId, toNode.capacityMeshNodeId],
        edgeId: edgeKey,
        connectionName,
        rootConnectionName,
      })

      // Add port point to both nodes for crossing calculations
      const portPoint: PortPoint = {
        x: exitPoint.x,
        y: exitPoint.y,
        z: singleZ,
        connectionName,
        rootConnectionName,
      }

      // Add to fromNode (this is an exit point for fromNode)
      const fromNodePortPoints =
        this.nodePortPointsMap.get(fromNode.capacityMeshNodeId) ?? []
      fromNodePortPoints.push(portPoint)
      this.nodePortPointsMap.set(
        fromNode.capacityMeshNodeId,
        fromNodePortPoints,
      )

      // Add to toNode (this is an entry point for toNode)
      const toNodePortPoints =
        this.nodePortPointsMap.get(toNode.capacityMeshNodeId) ?? []
      toNodePortPoints.push(portPoint)
      this.nodePortPointsMap.set(toNode.capacityMeshNodeId, toNodePortPoints)

      preferredZ = singleZ
    }

    return assignedPortPoints
  }

  /**
   * Add start/end target points to nodes for crossing calculations.
   * Called after path is assigned to add the connection's target points.
   */
  private addTargetPointsToNodes(
    path: CapacityMeshNode[],
    connection: SimpleRouteConnection,
    preferredZ: number,
  ) {
    const startNode = path[0]
    const endNode = path[path.length - 1]
    const startPoint = connection.pointsToConnect[0]
    const endPoint =
      connection.pointsToConnect[connection.pointsToConnect.length - 1]

    if (startNode && startPoint) {
      const startPortPoints =
        this.nodePortPointsMap.get(startNode.capacityMeshNodeId) ?? []
      startPortPoints.push({
        x: startPoint.x,
        y: startPoint.y,
        z: preferredZ,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodePortPointsMap.set(startNode.capacityMeshNodeId, startPortPoints)
    }

    if (endNode && endPoint) {
      const endPortPoints =
        this.nodePortPointsMap.get(endNode.capacityMeshNodeId) ?? []
      endPortPoints.push({
        x: endPoint.x,
        y: endPoint.y,
        z: preferredZ,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodePortPointsMap.set(endNode.capacityMeshNodeId, endPortPoints)
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
    const startPoint = nextConnection.connection.pointsToConnect[0]

    if (!this.candidates) {
      this.candidates = [
        {
          prevCandidate: null,
          node: start,
          entryPortPoint: null,
          entryPoint: startPoint
            ? { x: startPoint.x, y: startPoint.y }
            : start.center,
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
    if (this.candidates!.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates!.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates!.length - this.MAX_CANDIDATES_IN_MEMORY,
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
      const endPoint =
        nextConnection.connection.pointsToConnect[
          nextConnection.connection.pointsToConnect.length - 1
        ]
      const path = this.getBacktrackedPath({
        prevCandidate: currentCandidate,
        node: end,
        entryPortPoint: null,
        entryPoint: endPoint ? { x: endPoint.x, y: endPoint.y } : end.center,
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

      // Get the preferred Z layer from assigned port points
      const preferredZ =
        nextConnection.portPoints.length > 0
          ? (nextConnection.portPoints[0].availableZ[0] ?? 0)
          : 0

      // Add target points (start/end of connection) to nodes for crossing calculations
      this.addTargetPointsToNodes(path, nextConnection.connection, preferredZ)

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

      const exitPoint = this.getExitPointToNeighbor(
        currentCandidate.node,
        neighbor,
      )
      const g = this.computeG(
        currentCandidate,
        neighbor,
        exitPoint,
        connectionName,
      )
      const h = this.computeH(exitPoint, end)
      const f = g + h * this.GREEDY_MULTIPLIER

      this.candidates!.push({
        prevCandidate: currentCandidate,
        node: neighbor,
        entryPortPoint: null,
        entryPoint: exitPoint,
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
        // Build the path from this candidate back to start using entry points (port points)
        const candidatePath: Array<{ x: number; y: number }> = []
        let current: PathingCandidate | null = candidate
        while (current) {
          // Use entryPoint (port point location) instead of node center
          const point = current.entryPoint ?? current.node.center
          candidatePath.unshift({ x: point.x, y: point.y })
          current = current.prevCandidate
        }

        if (candidatePath.length >= 1) {
          graphics.lines!.push({
            points: candidatePath,
            strokeColor: safeTransparentize(connectionColor, 0.25),
          })

          // Compute G cost breakdown for the label
          const exitPoint = candidate.entryPoint ?? candidate.node.center
          const distanceCost = candidate.prevCandidate
            ? this.getDistanceBetweenPoints(
                candidate.prevCandidate.entryPoint ??
                  candidate.prevCandidate.node.center,
                exitPoint,
              )
            : 0

          // Determine the Z layer that would be used for this trace
          const mutualZ = candidate.prevCandidate
            ? candidate.prevCandidate.node.availableZ.filter((z: number) =>
                candidate.node.availableZ.includes(z),
              )
            : candidate.node.availableZ
          const traceZ =
            mutualZ.length > 0
              ? mutualZ[0]
              : (candidate.node.availableZ[0] ?? 0)

          // Create hypothetical port points for this trace
          const prevPoint =
            candidate.prevCandidate?.entryPoint ?? candidate.node.center
          const hypotheticalPortPoints: PortPoint[] = [
            {
              x: prevPoint.x,
              y: prevPoint.y,
              z: traceZ,
              connectionName: currentConnection?.connection.name ?? "",
            },
            {
              x: exitPoint.x,
              y: exitPoint.y,
              z: traceZ,
              connectionName: currentConnection?.connection.name ?? "",
            },
          ]

          // Show current pf (without this trace) and what it would be with this trace
          const currentPf = this.computeNodePf(candidate.node)
          const pfWithTrace = this.computeNodePf(
            candidate.node,
            hypotheticalPortPoints,
          )
          const pfPenalty = this.getNodePfPenalty(
            candidate.node,
            hypotheticalPortPoints,
          )
          const edgePenalty = candidate.prevCandidate
            ? this.getReusePenalty(candidate.prevCandidate.node, candidate.node)
            : 0

          // Draw a circle at the head of each candidate (at the port point location)
          const head = candidatePath[candidatePath.length - 1]
          graphics.circles!.push({
            center: head,
            radius: Math.min(candidate.node.height, candidate.node.width) * 0.1,
            fill: safeTransparentize(connectionColor, 0.25),
            label: `f: ${candidate.f.toFixed(2)}\ng: ${candidate.g.toFixed(2)}\nh: ${candidate.h.toFixed(2)}\ndist: ${distanceCost.toFixed(2)}\npf: ${currentPf.toFixed(3)} -> ${pfWithTrace.toFixed(3)}\nCost(pf): ${pfPenalty.toFixed(2)}\nedge: ${edgePenalty.toFixed(2)}`,
          })
        }
      }
    }

    return graphics
  }
}
