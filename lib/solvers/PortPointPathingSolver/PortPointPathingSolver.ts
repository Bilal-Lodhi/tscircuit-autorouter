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
  /** The z layer this candidate is on */
  z: number
  f: number
  g: number
  h: number
}

export interface ConnectionPathResult {
  connection: SimpleRouteConnection
  nodes: CapacityMeshNode[]
  /** The path of candidates (with z info) found by the pathing algorithm */
  path?: PathingCandidate[]
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
  NODE_REUSE_FACTOR = 2

  /** Multiplied by Pf**2 to get node probability penalty */
  NODE_PF_FACTOR = 100000

  /** Cost of adding a candidate to the path (penalizes long paths or useless candidates) */
  BASE_CANDIDATE_COST = 0.25

  /** Cost penalty for changing layers (any z difference > 0 incurs this constant cost) */
  Z_DIFF_COST = 0

  colorMap: Record<string, string>
  maxDepthOfNodes: number

  GREEDY_MULTIPLIER = 1
  MAX_CANDIDATES_IN_MEMORY = 50_000

  // Current pathing state
  currentConnectionIndex = 0
  candidates?: PathingCandidate[] | null
  /** Tracks visited (nodeId, z) pairs to avoid revisiting */
  visitedNodes?: Set<string> | null
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

    // if (crossings.numEntryExitLayerChanges > 0 && getTunedTotalCapacity1(node) < 0.5) {
    //   return
    // }

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
    targetZ: number,
  ): number {
    // Use point-to-point distance from the previous entry point to the new exit point
    const prevPoint = prevCandidate.entryPoint ?? prevCandidate.node.center
    const distanceCost = this.getDistanceBetweenPoints(prevPoint, exitPoint)

    // Create hypothetical port points for this trace passing through the node
    // Entry point uses prevCandidate's z, exit point uses targetZ
    const entryPortPoint: PortPoint = {
      x: prevPoint.x,
      y: prevPoint.y,
      z: prevCandidate.z,
      connectionName,
    }
    const exitPortPoint: PortPoint = {
      x: exitPoint.x,
      y: exitPoint.y,
      z: targetZ,
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
    currentZ: number,
  ): number {
    const distanceToGoal = this.getDistanceBetweenPoints(
      exitPoint,
      endGoal.center,
    )
    // Add layer change cost if current z is not available at the goal
    const needsLayerChange = !endGoal.availableZ.includes(currentZ)
    const zChangeCost = needsLayerChange ? this.Z_DIFF_COST : 0
    return distanceToGoal + zChangeCost
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

  private getBacktrackedPath(candidate: PathingCandidate): PathingCandidate[] {
    const path: PathingCandidate[] = []
    let current: PathingCandidate | null = candidate
    while (current) {
      path.push(current)
      current = current.prevCandidate
    }
    return path.reverse()
  }

  /**
   * Assign port points along a path and record which connections use them.
   * Returns an array with one entry per edge (path.length - 1 entries).
   * Creates port points at the midpoint of each shared edge.
   * Also adds port points to nodePortPointsMap for crossing calculations.
   * Uses the z from each candidate to properly track layer changes.
   */
  private assignPortPointsForPath(
    path: PathingCandidate[],
    connectionName: string,
    rootConnectionName?: string,
  ): SegmentPortPoint[] {
    const assignedPortPoints: SegmentPortPoint[] = []

    for (let i = 0; i < path.length - 1; i++) {
      const fromCandidate = path[i]
      const toCandidate = path[i + 1]
      const fromNode = fromCandidate.node
      const toNode = toCandidate.node

      // Get the edge key and increment usage count
      const edgeKey = this.getEdgeKey(
        fromNode.capacityMeshNodeId,
        toNode.capacityMeshNodeId,
      )
      const currentUsage = this.portPointUsageCount.get(edgeKey) ?? 0
      this.portPointUsageCount.set(edgeKey, currentUsage + 1)

      // Compute the midpoint of the shared edge
      const exitPoint = this.getExitPointToNeighbor(fromNode, toNode)

      // Use the z from toCandidate (the z layer we're entering the next node on)
      const singleZ = toCandidate.z

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
    }

    return assignedPortPoints
  }

  /**
   * Add start/end target points to nodes for crossing calculations.
   * Called after path is assigned to add the connection's target points.
   */
  private addTargetPointsToNodes(
    path: PathingCandidate[],
    connection: SimpleRouteConnection,
  ) {
    const startCandidate = path[0]
    const endCandidate = path[path.length - 1]
    const startPoint = connection.pointsToConnect[0]
    const endPoint =
      connection.pointsToConnect[connection.pointsToConnect.length - 1]

    if (startCandidate && startPoint) {
      const startPortPoints =
        this.nodePortPointsMap.get(startCandidate.node.capacityMeshNodeId) ?? []
      startPortPoints.push({
        x: startPoint.x,
        y: startPoint.y,
        z: startCandidate.z,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodePortPointsMap.set(
        startCandidate.node.capacityMeshNodeId,
        startPortPoints,
      )
    }

    if (endCandidate && endPoint) {
      const endPortPoints =
        this.nodePortPointsMap.get(endCandidate.node.capacityMeshNodeId) ?? []
      endPortPoints.push({
        x: endPoint.x,
        y: endPoint.y,
        z: endCandidate.z,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodePortPointsMap.set(
        endCandidate.node.capacityMeshNodeId,
        endPortPoints,
      )
    }
  }

  /**
   * Get a unique key for a (node, z) pair for tracking visited states
   */
  private getVisitedKey(nodeId: CapacityMeshNodeId, z: number): string {
    return `${nodeId}:${z}`
  }

  /**
   * Check if a nodeId is already in the candidate's path chain.
   * This prevents revisiting the same physical node in a single path,
   * which would create a node with only one connection side.
   */
  private isNodeInPathChain(
    candidate: PathingCandidate | null,
    nodeId: CapacityMeshNodeId,
  ): boolean {
    let current = candidate
    while (current) {
      if (current.node.capacityMeshNodeId === nodeId) return true
      current = current.prevCandidate
    }
    return false
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
      // Create initial candidates for each available z layer on the start node
      this.candidates = []
      this.visitedNodes = new Set<string>()

      for (const z of start.availableZ) {
        this.candidates.push({
          prevCandidate: null,
          node: start,
          entryPortPoint: null,
          entryPoint: startPoint
            ? { x: startPoint.x, y: startPoint.y }
            : start.center,
          z,
          f: 0,
          g: 0,
          h: 0,
        })
        this.visitedNodes.add(this.getVisitedKey(start.capacityMeshNodeId, z))
      }
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
        z: currentCandidate.z,
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

      // Add target points (start/end of connection) to nodes for crossing calculations
      this.addTargetPointsToNodes(path, nextConnection.connection)

      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      return
    }

    // Expand neighbors
    const neighbors = this.getNeighboringNodes(currentCandidate.node)
    // Filter to z layers that are also available at the end node
    const endAvailableZ = new Set(end.availableZ)

    for (const neighbor of neighbors) {
      if (!this.doesNodeHaveCapacity(neighbor, currentCandidate.node)) continue

      // Don't revisit the same physical node in this path chain
      // This prevents creating nodes with only one connection side
      if (
        this.isNodeInPathChain(currentCandidate, neighbor.capacityMeshNodeId)
      ) {
        continue
      }

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

      // Explore each available z layer for this neighbor (that is also available at end)
      for (const targetZ of neighbor.availableZ) {
        // Skip z layers not available at the end node
        if (!endAvailableZ.has(targetZ)) continue

        const visitedKey = this.getVisitedKey(
          neighbor.capacityMeshNodeId,
          targetZ,
        )
        if (this.visitedNodes?.has(visitedKey)) continue

        const g = this.computeG(
          currentCandidate,
          neighbor,
          exitPoint,
          connectionName,
          targetZ,
        )
        const h = this.computeH(exitPoint, end, targetZ)
        const f = g + h * this.GREEDY_MULTIPLIER

        this.candidates!.push({
          prevCandidate: currentCandidate,
          node: neighbor,
          entryPortPoint: null,
          entryPoint: exitPoint,
          z: targetZ,
          f,
          g,
          h,
        })
      }
    }

    this.visitedNodes!.add(
      this.getVisitedKey(
        currentCandidate.node.capacityMeshNodeId,
        currentCandidate.z,
      ),
    )
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
      const startCandidate = path[0]
      const endCandidate = path[path.length - 1]
      const startPoint = connection.pointsToConnect[0]
      const endPoint =
        connection.pointsToConnect[connection.pointsToConnect.length - 1]

      if (startPoint && startCandidate) {
        addPortPoint(startCandidate.node.capacityMeshNodeId, connection.name, {
          x: startPoint.x,
          y: startPoint.y,
          z: startCandidate.z,
        })
      }

      if (endPoint && endCandidate) {
        addPortPoint(endCandidate.node.capacityMeshNodeId, connection.name, {
          x: endPoint.x,
          y: endPoint.y,
          z: endCandidate.z,
        })
      }

      // Add port points to both adjacent nodes for each edge
      for (let i = 0; i < portPoints.length; i++) {
        const portPoint = portPoints[i]
        if (!portPoint) continue

        // This port point is on the edge between path[i] and path[i+1]
        // It should be added to both nodes
        const candidateA = path[i]
        const candidateB = path[i + 1]

        if (candidateA && candidateB) {
          const z = portPoint.availableZ[0] ?? 0
          addPortPoint(candidateA.node.capacityMeshNodeId, connection.name, {
            x: portPoint.x,
            y: portPoint.y,
            z,
          })
          addPortPoint(candidateB.node.capacityMeshNodeId, connection.name, {
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

      const nodeWithPortPoints = this.buildNodeWithPortPoints(node)
      const crossings = getIntraNodeCrossings(nodeWithPortPoints)

      graphics.rects!.push({
        center: node.center,
        width: node.width * 0.9,
        height: node.height * 0.9,
        layer: `z${node.availableZ.join(",")}`,
        fill: color,
        label: `${node.capacityMeshNodeId}\npf: ${pf.toFixed(3)}\nxSame: ${crossings.numSameLayerCrossings}, xLC: ${crossings.numEntryExitLayerChanges}, xTransition: ${crossings.numTransitionPairCrossings}`,
      })
    }

    // Draw solved paths using port points
    for (const result of this.connectionsWithResults) {
      if (!result.path || !result.portPoints) continue

      const connection = result.connection
      const color = this.colorMap[connection.name] ?? "blue"
      const startPoint = connection.pointsToConnect[0]

      // Build segment points with z values for proper dash styling
      interface PointWithZ {
        x: number
        y: number
        z: number
      }
      const segmentPoints: PointWithZ[] = []

      // Add start point with z from start candidate
      if (startPoint) {
        const startZ = result.path[0]?.z ?? 0
        segmentPoints.push({ x: startPoint.x, y: startPoint.y, z: startZ })
      }

      // Add port points with z values
      for (const portPoint of result.portPoints) {
        const z = portPoint.availableZ[0] ?? 0
        segmentPoints.push({ x: portPoint.x, y: portPoint.y, z })
      }

      // Add end point with z from end candidate
      const endPoint =
        connection.pointsToConnect[connection.pointsToConnect.length - 1]
      if (endPoint) {
        const endZ = result.path[result.path.length - 1]?.z ?? 0
        segmentPoints.push({ x: endPoint.x, y: endPoint.y, z: endZ })
      }

      // Draw segments between consecutive points with dash style based on z
      for (let i = 0; i < segmentPoints.length - 1; i++) {
        const pointA = segmentPoints[i]
        const pointB = segmentPoints[i + 1]

        // Determine line style based on layer (z) values
        const sameLayer = pointA.z === pointB.z
        const commonLayer = pointA.z

        let strokeDash: string | undefined
        if (sameLayer) {
          strokeDash = commonLayer === 0 ? undefined : "10 5" // top layer: solid, bottom layer: long dash
        } else {
          strokeDash = "3 3 10" // transition between layers: mixed dash pattern
        }

        graphics.lines!.push({
          points: [
            { x: pointA.x, y: pointA.y },
            { x: pointB.x, y: pointB.y },
          ],
          strokeColor: color,
          strokeDash,
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

          // Create hypothetical port points for this trace using candidate's z
          const prevPoint =
            candidate.prevCandidate?.entryPoint ?? candidate.node.center
          const prevZ = candidate.prevCandidate?.z ?? candidate.z
          const hypotheticalPortPoints: PortPoint[] = [
            {
              x: prevPoint.x,
              y: prevPoint.y,
              z: prevZ,
              connectionName: currentConnection?.connection.name ?? "",
            },
            {
              x: exitPoint.x,
              y: exitPoint.y,
              z: candidate.z,
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
            layer: `z${candidate.z}`,
            label: [
              `f: ${candidate.f.toFixed(2)}`,
              `g: ${candidate.g.toFixed(2)}`,
              `h: ${candidate.h.toFixed(2)}`,
              `z: ${candidate.z}`,
              `dist: ${distanceCost.toFixed(2)}`,
              `pf: ${currentPf.toFixed(3)} -> ${pfWithTrace.toFixed(3)}`,
              `Cost(pf): ${pfPenalty.toFixed(2)}`,
              `edge: ${edgePenalty.toFixed(2)}`,
            ].join("\n"),
          })
        }
      }
    }

    return graphics
  }
}
