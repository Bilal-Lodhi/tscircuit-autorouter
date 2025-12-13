import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import { distance } from "@tscircuit/math-utils"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import type {
  PortPoint,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { visualizePointPathSolver } from "./visualizePointPathSolver"
import {
  cloneAndShuffleArray,
  seededRandom,
} from "lib/utils/cloneAndShuffleArray"

export interface PortPointPathingHyperParameters {
  SHUFFLE_SEED?: number
  CENTER_OFFSET_DIST_PENALTY_FACTOR?: number
  CENTER_OFFSET_FOCUS_SHIFT?: number
  GREEDY_MULTIPLIER?: number
  NODE_PF_FACTOR?: number

  MEMORY_PF_FACTOR?: number
  MAX_ITERATIONS_PER_PATH?: number
}

/**
 * An input port point without connectionName assigned yet.
 * These are pre-computed points on node edges where traces can cross.
 */
export interface InputPortPoint {
  portPointId: string
  x: number
  y: number
  z: number
  /** The node IDs that this port point connects (on the shared edge) */
  connectionNodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  /** XY distance to the centermost port on this Z level (centermost port has distance 0) */
  distToCentermostPortOnZ: number
}

/**
 * A node with pre-computed port points (without connectionName assigned).
 * This is the input format for PortPointPathingSolver.
 */
export interface InputNodeWithPortPoints {
  capacityMeshNodeId: CapacityMeshNodeId
  center: { x: number; y: number }
  width: number
  height: number
  /** Port points on this node's edges (without connectionName) */
  portPoints: InputPortPoint[]
  availableZ: number[]
  /** If true, this node is a target node (contains a connection endpoint) */
  _containsTarget?: boolean
  /** If true, this node contains an obstacle */
  _containsObstacle?: boolean
}

/**
 * A candidate in the A* search. Represents being at a port point,
 * having entered from a specific node.
 */
export interface PortPointCandidate {
  prevCandidate: PortPointCandidate | null
  /** The port point we're at (null for start/end target points) */
  portPoint: InputPortPoint | null
  /** The node we're currently in (entered via portPoint) */
  currentNodeId: CapacityMeshNodeId
  /** The physical point location */
  point: { x: number; y: number }
  /** The z layer this candidate is on */
  z: number
  f: number
  g: number
  h: number
}

export interface ConnectionPathResult {
  connection: SimpleRouteConnection
  /** Start and end node IDs */
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  /** The path of candidates found by the pathing algorithm */
  path?: PortPointCandidate[]
  /** Port points used by this connection (with connectionName assigned) */
  portPoints?: PortPoint[]
  straightLineDistance: number
}

/**
 * PortPointPathingSolver finds paths through the capacity mesh by visiting
 * pre-computed port points on shared edges. It considers layer information
 * when routing and uses a probability-of-failure based cost function.
 *
 * Key features:
 * 1. Takes InputNodeWithPortPoints[] as input (port points without connectionName)
 * 2. Routes by visiting port points (not nodes)
 * 3. Assigns connectionName to port points as paths are found
 * 4. Uses pf-based cost function that considers crossings
 */
export class PortPointPathingSolver extends BaseSolver {
  hyperParameters: Partial<PortPointPathingHyperParameters>

  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]

  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
  /** Map from nodeId to list of port points accessible from that node */
  nodePortPointsMap: Map<CapacityMeshNodeId, InputPortPoint[]>
  /** Map from portPointId to InputPortPoint */
  portPointMap: Map<string, InputPortPoint>

  connectionsWithResults: ConnectionPathResult[] = []

  /** Tracks port points that have been assigned to connections */
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  > = new Map()

  /** Tracks port points assigned to each node for crossing calculations */
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]> = new Map()

  /** Factor applied to port point reuse penalty */
  PORT_POINT_REUSE_FACTOR = 1000

  /** Multiplied by Pf**2 to get node probability penalty */
  get NODE_PF_FACTOR() {
    return this.hyperParameters.NODE_PF_FACTOR ?? 50
  }

  get MEMORY_PF_FACTOR() {
    return this.hyperParameters.MEMORY_PF_FACTOR ?? 0
  }

  get CENTER_OFFSET_FOCUS_SHIFT() {
    return this.hyperParameters.CENTER_OFFSET_FOCUS_SHIFT ?? 0
  }

  /** Cost of adding a candidate to the path */
  BASE_CANDIDATE_COST = 0.4

  /** Cost penalty for changing layers */
  Z_DIST_COST = 0

  /** Penalty factor for port points that are far from the center of the segment */
  get CENTER_OFFSET_DIST_PENALTY_FACTOR() {
    return this.hyperParameters.CENTER_OFFSET_DIST_PENALTY_FACTOR ?? 10
  }

  colorMap: Record<string, string>

  get GREEDY_MULTIPLIER() {
    return this.hyperParameters.GREEDY_MULTIPLIER ?? 5
  }
  MAX_CANDIDATES_IN_MEMORY = 50_000

  get MAX_ITERATIONS_PER_PATH() {
    return this.hyperParameters.MAX_ITERATIONS_PER_PATH ?? 5e3
  }

  nodeMemoryPfMap: Map<CapacityMeshNodeId, number>

  // Current pathing state
  currentConnectionIndex = 0
  currentPathIterations = 0
  candidates?: PortPointCandidate[] | null
  /** Tracks visited port point IDs to avoid revisiting */
  visitedPortPoints?: Set<string> | null
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>

  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>

  constructor({
    simpleRouteJson,
    inputNodes,
    capacityMeshNodes,
    colorMap,
    nodeMemoryPfMap,
    hyperParameters,
  }: {
    simpleRouteJson: SimpleRouteJson
    capacityMeshNodes: CapacityMeshNode[]
    inputNodes: InputNodeWithPortPoints[]
    colorMap?: Record<string, string>
    nodeMemoryPfMap?: Map<CapacityMeshNodeId, number>
    hyperParameters?: Partial<PortPointPathingHyperParameters>
  }) {
    super()
    this.MAX_ITERATIONS = 20e3
    this.simpleRouteJson = simpleRouteJson
    this.inputNodes = inputNodes
    this.colorMap = colorMap ?? {}
    this.capacityMeshNodeMap = new Map(
      capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
    )
    this.nodeMemoryPfMap = nodeMemoryPfMap ?? new Map()
    this.hyperParameters = hyperParameters ?? {
      SHUFFLE_SEED: 0,
    }
    this.nodeMap = new Map(inputNodes.map((n) => [n.capacityMeshNodeId, n]))

    // Build port point maps
    this.portPointMap = new Map()
    this.nodePortPointsMap = new Map()

    for (const node of inputNodes) {
      this.nodePortPointsMap.set(node.capacityMeshNodeId, [])
      this.nodeAssignedPortPoints.set(node.capacityMeshNodeId, [])
    }

    for (const node of inputNodes) {
      for (const pp of node.portPoints) {
        this.portPointMap.set(pp.portPointId, pp)

        // Add to both nodes that share this port point
        for (const nodeId of pp.connectionNodeIds) {
          const nodePortPoints = this.nodePortPointsMap.get(nodeId)
          if (
            nodePortPoints &&
            !nodePortPoints.some((p) => p.portPointId === pp.portPointId)
          ) {
            nodePortPoints.push(pp)
          }
        }
      }
    }

    const { connectionsWithResults, connectionNameToGoalNodeIds } =
      this.getConnectionsWithNodes()
    this.connectionsWithResults = connectionsWithResults
    this.connectionNameToGoalNodeIds = connectionNameToGoalNodeIds
  }

  getConnectionsWithNodes() {
    let connectionsWithResults: ConnectionPathResult[] = []
    const nodesWithTargets = this.inputNodes.filter((n) => n._containsTarget)
    const connectionNameToGoalNodeIds = new Map<string, CapacityMeshNodeId[]>()

    for (const connection of this.simpleRouteJson.connections) {
      const nodesForConnection: InputNodeWithPortPoints[] = []

      for (const point of connection.pointsToConnect) {
        let closestNode = this.inputNodes[0]
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
        nodeIds: [
          nodesForConnection[0].capacityMeshNodeId,
          nodesForConnection[nodesForConnection.length - 1].capacityMeshNodeId,
        ],
        straightLineDistance: distance(
          nodesForConnection[0].center,
          nodesForConnection[nodesForConnection.length - 1].center,
        ),
      })
    }

    // Sort by straight-line distance (shorter first)
    // connectionsWithResults.sort(
    //   (a, b) => a.straightLineDistance - b.straightLineDistance,
    // )
    connectionsWithResults = cloneAndShuffleArray(
      connectionsWithResults,
      this.hyperParameters.SHUFFLE_SEED ?? 0,
    )

    return { connectionsWithResults, connectionNameToGoalNodeIds }
  }

  /**
   * Build a NodeWithPortPoints structure for crossing calculation.
   */
  buildNodeWithPortPointsForCrossing(
    node: InputNodeWithPortPoints,
    additionalPortPoints?: PortPoint[],
  ): NodeWithPortPoints {
    const existingPortPoints =
      this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
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
   */
  computeNodePf(
    node: InputNodeWithPortPoints,
    additionalPortPoints?: PortPoint[],
  ): number {
    if (node._containsTarget) return 0

    const nodeWithPortPoints = this.buildNodeWithPortPointsForCrossing(
      node,
      additionalPortPoints,
    )
    const crossings = getIntraNodeCrossings(nodeWithPortPoints)

    return calculateNodeProbabilityOfFailure(
      this.capacityMeshNodeMap.get(node.capacityMeshNodeId)!,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  /**
   * Cost penalty based on node probability of failure.
   */
  getNodePfPenalty(
    node: InputNodeWithPortPoints,
    additionalPortPoints?: PortPoint[],
  ): number {
    const pf = this.computeNodePf(node, additionalPortPoints)
    const memoryPf = this.nodeMemoryPfMap.get(node.capacityMeshNodeId) ?? 0
    return pf ** 2 * this.NODE_PF_FACTOR + memoryPf ** 2 * this.MEMORY_PF_FACTOR
  }

  /**
   * Get penalty for reusing a port point that's already assigned.
   * No penalty if the port point is assigned to a connection with the same rootConnectionName.
   */
  getPortPointReusePenalty(
    portPointId: string,
    rootConnectionName?: string,
  ): number {
    const assigned = this.assignedPortPoints.get(portPointId)
    if (!assigned) return 0
    if (rootConnectionName === assigned.rootConnectionName) return 0

    return this.PORT_POINT_REUSE_FACTOR
  }

  /**
   * Get the node on the "other side" of a port point from the given node
   */
  getOtherNodeId(
    portPoint: InputPortPoint,
    currentNodeId: CapacityMeshNodeId,
  ): CapacityMeshNodeId | null {
    const [nodeId1, nodeId2] = portPoint.connectionNodeIds
    if (nodeId1 === currentNodeId) return nodeId2
    if (nodeId2 === currentNodeId) return nodeId1
    return null
  }

  computeG(
    prevCandidate: PortPointCandidate,
    portPoint: InputPortPoint,
    targetNodeId: CapacityMeshNodeId,
    connectionName: string,
    rootConnectionName?: string,
  ): number {
    const prevPoint = prevCandidate.point
    const distanceCost = distance(prevPoint, { x: portPoint.x, y: portPoint.y })

    // Create hypothetical port points for crossing calculation
    const targetNode = this.nodeMap.get(targetNodeId)
    if (!targetNode)
      return prevCandidate.g + distanceCost + this.BASE_CANDIDATE_COST

    const entryPortPoint: PortPoint = {
      x: prevPoint.x,
      y: prevPoint.y,
      z: prevCandidate.z,
      connectionName,
    }
    const exitPortPoint: PortPoint = {
      x: portPoint.x,
      y: portPoint.y,
      z: portPoint.z,
      connectionName,
    }

    const pfPenalty = this.getNodePfPenalty(targetNode, [
      entryPortPoint,
      exitPortPoint,
    ])
    const reusePenalty = this.getPortPointReusePenalty(
      portPoint.portPointId,
      rootConnectionName,
    )
    let distToCentermostPortWithFocusShift =
      portPoint.distToCentermostPortOnZ - this.CENTER_OFFSET_FOCUS_SHIFT
    if (distToCentermostPortWithFocusShift < 0) {
      distToCentermostPortWithFocusShift =
        1 - distToCentermostPortWithFocusShift
    }
    const centerOffsetPenalty =
      distToCentermostPortWithFocusShift ** 2 *
      this.CENTER_OFFSET_DIST_PENALTY_FACTOR

    return (
      prevCandidate.g +
      this.BASE_CANDIDATE_COST +
      distanceCost +
      pfPenalty +
      reusePenalty +
      centerOffsetPenalty
    )
  }

  computeH(
    point: { x: number; y: number },
    endGoalNodeId: CapacityMeshNodeId,
    currentZ: number,
  ): number {
    const endNode = this.nodeMap.get(endGoalNodeId)
    if (!endNode) return 0

    const distanceToGoal = distance(point, endNode.center)
    const needsLayerChange = !endNode.availableZ.includes(currentZ)
    const zChangeCost = needsLayerChange ? this.Z_DIST_COST : 0
    return distanceToGoal + zChangeCost
  }

  /**
   * Get available port points to exit from a node (excluding already visited ones)
   */
  getAvailableExitPortPoints(
    nodeId: CapacityMeshNodeId,
    endGoalNodeId: CapacityMeshNodeId,
  ): InputPortPoint[] {
    const portPoints = this.nodePortPointsMap.get(nodeId) ?? []
    const endNode = this.nodeMap.get(endGoalNodeId)
    const endAvailableZ = new Set(endNode?.availableZ ?? [])

    return portPoints.filter((pp) => {
      // Skip if already visited in this path
      if (this.visitedPortPoints?.has(pp.portPointId)) return false
      return true
    })
  }

  canTravelThroughObstacle(
    node: InputNodeWithPortPoints,
    connectionName: string,
  ): boolean {
    const goalNodeIds = this.connectionNameToGoalNodeIds.get(connectionName)
    return goalNodeIds?.includes(node.capacityMeshNodeId) ?? false
  }

  /**
   * Check if we've reached the end goal node
   */
  isAtEndGoal(
    currentNodeId: CapacityMeshNodeId,
    endGoalNodeId: CapacityMeshNodeId,
  ): boolean {
    return currentNodeId === endGoalNodeId
  }

  getBacktrackedPath(candidate: PortPointCandidate): PortPointCandidate[] {
    const path: PortPointCandidate[] = []
    let current: PortPointCandidate | null = candidate
    while (current) {
      path.push(current)
      current = current.prevCandidate
    }
    return path.reverse()
  }

  /**
   * Assign port points along a path and record which connections use them.
   */
  assignPortPointsForPath(
    path: PortPointCandidate[],
    connectionName: string,
    rootConnectionName?: string,
  ): PortPoint[] {
    const assignedPortPoints: PortPoint[] = []

    for (const candidate of path) {
      if (!candidate.portPoint) continue // Skip start/end target points

      const pp = candidate.portPoint

      // Mark port point as assigned
      this.assignedPortPoints.set(pp.portPointId, {
        connectionName,
        rootConnectionName,
      })

      const portPoint: PortPoint = {
        x: pp.x,
        y: pp.y,
        z: pp.z,
        connectionName,
        rootConnectionName,
      }

      assignedPortPoints.push(portPoint)

      // Add to both nodes for crossing calculations
      for (const nodeId of pp.connectionNodeIds) {
        const nodePortPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
        nodePortPoints.push(portPoint)
        this.nodeAssignedPortPoints.set(nodeId, nodePortPoints)
      }
    }

    return assignedPortPoints
  }

  /**
   * Add start/end target points to nodes for crossing calculations.
   */
  addTargetPointsToNodes(
    path: PortPointCandidate[],
    connection: SimpleRouteConnection,
  ) {
    const startCandidate = path[0]
    const endCandidate = path[path.length - 1]
    const startPoint = connection.pointsToConnect[0]
    const endPoint =
      connection.pointsToConnect[connection.pointsToConnect.length - 1]

    if (startCandidate && startPoint) {
      const startPortPoints =
        this.nodeAssignedPortPoints.get(startCandidate.currentNodeId) ?? []
      startPortPoints.push({
        x: startPoint.x,
        y: startPoint.y,
        z: startCandidate.z,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodeAssignedPortPoints.set(
        startCandidate.currentNodeId,
        startPortPoints,
      )
    }

    if (endCandidate && endPoint) {
      const endPortPoints =
        this.nodeAssignedPortPoints.get(endCandidate.currentNodeId) ?? []
      endPortPoints.push({
        x: endPoint.x,
        y: endPoint.y,
        z: endCandidate.z,
        connectionName: connection.name,
        rootConnectionName: connection.rootConnectionName,
      })
      this.nodeAssignedPortPoints.set(endCandidate.currentNodeId, endPortPoints)
    }
  }

  /**
   * Check if a port point is already in the candidate's path chain.
   */
  isPortPointInPathChain(
    candidate: PortPointCandidate | null,
    portPointId: string,
  ): boolean {
    let current = candidate
    while (current) {
      if (current.portPoint?.portPointId === portPointId) return true
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

    // Check if we've exceeded max iterations for this path
    this.currentPathIterations++
    if (this.currentPathIterations > this.MAX_ITERATIONS_PER_PATH) {
      console.error(
        `Exceeded MAX_ITERATIONS_PER_PATH (${this.MAX_ITERATIONS_PER_PATH}) on connection ${nextConnection.connection.name}`,
      )
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      this.failed = true
      return
    }

    const [startNodeId, endNodeId] = nextConnection.nodeIds
    const startNode = this.nodeMap.get(startNodeId)
    const endNode = this.nodeMap.get(endNodeId)
    if (!startNode || !endNode) {
      this.currentConnectionIndex++
      this.currentPathIterations = 0
      return
    }

    const startPoint = nextConnection.connection.pointsToConnect[0]

    if (!this.candidates) {
      // Create initial candidates for each available z layer on the start node
      this.candidates = []
      this.visitedPortPoints = new Set<string>()

      for (const z of startNode.availableZ) {
        this.candidates.push({
          prevCandidate: null,
          portPoint: null, // Start is at target point, not a port point
          currentNodeId: startNodeId,
          point: startPoint
            ? { x: startPoint.x, y: startPoint.y }
            : startNode.center,
          z,
          f: 0,
          g: 0,
          h: 0,
        })
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
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      this.failed = true
      return
    }

    // Check if we're at or connected to the goal
    if (this.isAtEndGoal(currentCandidate.currentNodeId, endNodeId)) {
      const endPoint =
        nextConnection.connection.pointsToConnect[
          nextConnection.connection.pointsToConnect.length - 1
        ]

      // Create final candidate at end goal
      const finalCandidate: PortPointCandidate = {
        prevCandidate: currentCandidate,
        portPoint: null,
        currentNodeId: endNodeId,
        point: endPoint ? { x: endPoint.x, y: endPoint.y } : endNode.center,
        z: currentCandidate.z,
        f: 0,
        g: 0,
        h: 0,
      }

      const path = this.getBacktrackedPath(finalCandidate)
      nextConnection.path = path
      nextConnection.portPoints = this.assignPortPointsForPath(
        path,
        nextConnection.connection.name,
        nextConnection.connection.rootConnectionName,
      )

      // Add target points to nodes for crossing calculations
      this.addTargetPointsToNodes(path, nextConnection.connection)

      this.currentConnectionIndex++
      this.candidates = null
      this.visitedPortPoints = null
      this.currentPathIterations = 0
      return
    }

    // Expand to available port points from current node
    const connectionName = nextConnection.connection.name
    const availablePortPoints = this.getAvailableExitPortPoints(
      currentCandidate.currentNodeId,
      endNodeId,
    )

    for (const portPoint of availablePortPoints) {
      // Don't revisit port points in this path
      if (
        this.isPortPointInPathChain(currentCandidate, portPoint.portPointId)
      ) {
        continue
      }

      // Get the node we'd enter via this port point
      const targetNodeId = this.getOtherNodeId(
        portPoint,
        currentCandidate.currentNodeId,
      )
      if (!targetNodeId) continue

      const targetNode = this.nodeMap.get(targetNodeId)
      if (!targetNode) continue

      // Check obstacle constraints
      if (
        targetNode._containsObstacle &&
        !this.canTravelThroughObstacle(targetNode, connectionName)
      ) {
        continue
      }

      const g = this.computeG(
        currentCandidate,
        portPoint,
        targetNodeId,
        connectionName,
        nextConnection.connection.rootConnectionName,
      )
      const h = this.computeH(
        { x: portPoint.x, y: portPoint.y },
        endNodeId,
        portPoint.z,
      )
      const f = g + h * this.GREEDY_MULTIPLIER

      this.candidates!.push({
        prevCandidate: currentCandidate,
        portPoint,
        currentNodeId: targetNodeId,
        point: { x: portPoint.x, y: portPoint.y },
        z: portPoint.z,
        f,
        g,
        h,
      })
    }

    // Mark current port point as visited (if any)
    if (currentCandidate.portPoint) {
      this.visitedPortPoints!.add(currentCandidate.portPoint.portPointId)
    }
  }

  /**
   * Get the nodes with port points for the HighDensitySolver
   */
  getNodesWithPortPoints(): NodeWithPortPoints[] {
    const result: NodeWithPortPoints[] = []

    for (const node of this.inputNodes) {
      const assignedPortPoints =
        this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []

      if (assignedPortPoints.length > 0) {
        result.push({
          capacityMeshNodeId: node.capacityMeshNodeId,
          center: node.center,
          width: node.width,
          height: node.height,
          portPoints: assignedPortPoints,
          availableZ: node.availableZ,
        })
      }
    }

    return result
  }

  visualize(): GraphicsObject {
    return visualizePointPathSolver(this)
  }
}
