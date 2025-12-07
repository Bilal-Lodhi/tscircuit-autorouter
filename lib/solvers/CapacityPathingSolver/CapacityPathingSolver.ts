import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  CapacityPath,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../../types"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"
import { distance, doSegmentsIntersect } from "@tscircuit/math-utils"
import { CapacityHyperParameters } from "../CapacityHyperParameters"
import { GraphicsObject } from "graphics-debug"
import { safeTransparentize } from "../colors"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

export type Candidate = {
  prevCandidate: Candidate | null
  node: CapacityMeshNode
  f: number
  g: number
  h: number
  /** The designated z-layer for this candidate path */
  designatedZ?: number
}

export type ConnectionPathWithNodes = {
  connection: SimpleRouteConnection
  nodes: CapacityMeshNode[]
  path?: CapacityMeshNode[]
  straightLineDistance: number
  /** Chosen z-layer for the start point (for multi-layer connection points) */
  startZ?: number
  /** Chosen z-layer for the end point (for multi-layer connection points) */
  endZ?: number
}

export class CapacityPathingSolver extends BaseSolver {
  connectionsWithNodes: Array<ConnectionPathWithNodes>

  usedNodeCapacityMap: Map<CapacityMeshNodeId, number>

  simpleRouteJson: SimpleRouteJson
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  GREEDY_MULTIPLIER = 1.1
  MAX_CANDIDATES_IN_MEMORY = 100_000

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>
  colorMap: Record<string, string>
  maxDepthOfNodes: number

  activeCandidateStraightLineDistance?: number

  debug_lastNodeCostMap: Map<
    CapacityMeshNodeId,
    {
      g: number
      h: number
      f: number
    }
  >

  hyperParameters: Partial<CapacityHyperParameters>

  constructor({
    simpleRouteJson,
    nodes,
    edges,
    colorMap,
    MAX_ITERATIONS = 1e6,
    hyperParameters = {},
  }: {
    simpleRouteJson: SimpleRouteJson
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    colorMap?: Record<string, string>
    MAX_ITERATIONS?: number
    hyperParameters?: Partial<CapacityHyperParameters>
  }) {
    super()
    this.MAX_ITERATIONS = MAX_ITERATIONS
    this.simpleRouteJson = simpleRouteJson
    this.nodes = nodes
    this.edges = edges
    this.colorMap = colorMap ?? {}
    const { connectionsWithNodes, connectionNameToGoalNodeIds } =
      this.getConnectionsWithNodes()
    this.connectionsWithNodes = connectionsWithNodes
    this.connectionNameToGoalNodeIds = connectionNameToGoalNodeIds
    this.hyperParameters = hyperParameters
    this.usedNodeCapacityMap = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, 0]),
    )
    this.nodeMap = new Map(
      this.nodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    this.nodeEdgeMap = getNodeEdgeMap(this.edges)
    this.maxDepthOfNodes = Math.max(
      ...this.nodes.map((node) => node._depth ?? 0),
    )
    this.debug_lastNodeCostMap = new Map()
  }

  getTotalCapacity(node: CapacityMeshNode): number {
    const depth = node._depth ?? 0
    return (this.maxDepthOfNodes - depth + 1) ** 2
  }

  getConnectionsWithNodes() {
    const connectionsWithNodes: Array<{
      connection: SimpleRouteConnection
      nodes: CapacityMeshNode[]
      pathFound: boolean
      straightLineDistance: number
    }> = []
    const nodesWithTargets = this.nodes.filter((node) => node._containsTarget)
    const connectionNameToGoalNodeIds = new Map<string, CapacityMeshNodeId[]>()

    for (const connection of this.simpleRouteJson.connections) {
      const nodesForConnection: CapacityMeshNode[] = []
      for (const point of connection.pointsToConnect) {
        let closestNode = this.nodes[0]
        let minDistance = Number.MAX_VALUE

        for (const node of nodesWithTargets) {
          const distance = Math.sqrt(
            (node.center.x - point.x) ** 2 + (node.center.y - point.y) ** 2,
          )
          if (distance < minDistance) {
            minDistance = distance
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
      connectionsWithNodes.push({
        connection,
        nodes: nodesForConnection,
        pathFound: false,
        straightLineDistance: distance(
          nodesForConnection[0].center,
          nodesForConnection[nodesForConnection.length - 1].center,
        ),
      })
    }

    connectionsWithNodes.sort(
      (a, b) => a.straightLineDistance - b.straightLineDistance,
    )
    return { connectionsWithNodes, connectionNameToGoalNodeIds }
  }

  currentConnectionIndex = 0

  candidates?: Array<Candidate> | null
  /** Tracks visited/closed nodes as "nodeId:layer" format for layer-aware pathfinding */
  visitedNodes?: Set<string> | null
  /** Tracks best g-cost seen for each "nodeId:layer" to avoid adding worse paths */
  bestGCostMap?: Map<string, number> | null

  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    return (
      prevCandidate.g + this.getDistanceBetweenNodes(prevCandidate.node, node)
    )
  }

  computeH(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    return this.getDistanceBetweenNodes(node, endGoal)
  }

  getBacktrackedPath(candidate: Candidate) {
    const path: CapacityMeshNode[] = []
    let currentCandidate = candidate
    while (currentCandidate) {
      path.push(currentCandidate.node)
      currentCandidate = currentCandidate.prevCandidate!
    }
    return path
  }

  getNeighboringNodes(node: CapacityMeshNode) {
    return this.nodeEdgeMap
      .get(node.capacityMeshNodeId)!
      .flatMap((edge): CapacityMeshNodeId[] =>
        edge.nodeIds.filter((n) => n !== node.capacityMeshNodeId),
      )
      .map((n) => this.nodeMap.get(n)!)
  }

  getCapacityPaths() {
    const capacityPaths: CapacityPath[] = []
    for (const connection of this.connectionsWithNodes) {
      const path = connection.path
      if (path) {
        capacityPaths.push({
          capacityPathId: connection.connection.name,
          connectionName: connection.connection.name,
          nodeIds: path.map((node) => node.capacityMeshNodeId),
          startZ: connection.startZ,
          endZ: connection.endZ,
        })
      }
    }
    return capacityPaths
  }

  doesNodeHaveCapacityForTrace(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode,
  ) {
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
    const totalCapacity = this.getTotalCapacity(node)

    // Single layer nodes can't safely have multiple traces because there's no
    // way to cross over two traces without a via
    if (
      node.availableZ.length === 1 &&
      !node._containsTarget &&
      usedCapacity > 0
    )
      return false

    let additionalCapacityRequirement = 0
    if (node.availableZ.length > 1 && prevNode.availableZ.length === 1) {
      additionalCapacityRequirement += 0.5
    }

    return usedCapacity + additionalCapacityRequirement < totalCapacity
  }

  canTravelThroughObstacle(node: CapacityMeshNode, connectionName: string) {
    const goalNodeIds = this.connectionNameToGoalNodeIds.get(connectionName)

    return goalNodeIds?.includes(node.capacityMeshNodeId) ?? false
  }

  getDistanceBetweenNodes(A: CapacityMeshNode, B: CapacityMeshNode) {
    return Math.sqrt(
      (A.center.x - B.center.x) ** 2 + (A.center.y - B.center.y) ** 2,
    )
  }

  reduceCapacityAlongPath(nextConnection: { path?: CapacityMeshNode[] }) {
    for (const node of nextConnection.path ?? []) {
      this.usedNodeCapacityMap.set(
        node.capacityMeshNodeId,
        this.usedNodeCapacityMap.get(node.capacityMeshNodeId)! + 1,
      )
    }
  }

  isConnectedToEndGoal(node: CapacityMeshNode, endGoal: CapacityMeshNode) {
    return this.nodeEdgeMap
      .get(node.capacityMeshNodeId)!
      .some((edge) => edge.nodeIds.includes(endGoal.capacityMeshNodeId))
  }

  /**
   * After all paths are found, assign layers to MLCP connections to avoid crossings.
   * Connections that share intermediate nodes might cross and need different layers.
   */
  assignLayersToMLCPConnections() {
    // Find connections where both endpoints are MLCPs
    const mlcpConnections = this.connectionsWithNodes.filter((conn) => {
      if (!conn.path || conn.path.length < 2) return false
      const startNode = conn.path[conn.path.length - 1] // path is reversed
      const endNode = conn.path[0]
      return (
        startNode._isMultiLayerConnectionPoint &&
        endNode._isMultiLayerConnectionPoint
      )
    })

    if (mlcpConnections.length === 0) return

    // Build conflict graph: connections conflict if they share intermediate nodes
    // OR if they cross geometrically
    const conflicts = new Map<string, Set<string>>()
    for (const conn of mlcpConnections) {
      conflicts.set(conn.connection.name, new Set())
    }

    // Helper to check if two paths cross geometrically
    const pathsCrossGeometrically = (pathA: CapacityMeshNode[], pathB: CapacityMeshNode[]): boolean => {
      // Check each segment of path A against each segment of path B
      for (let i = 0; i < pathA.length - 1; i++) {
        const a1 = pathA[i].center
        const a2 = pathA[i + 1].center
        for (let j = 0; j < pathB.length - 1; j++) {
          const b1 = pathB[j].center
          const b2 = pathB[j + 1].center
          // Skip if segments share an endpoint (not a real crossing)
          if (
            (a1.x === b1.x && a1.y === b1.y) ||
            (a1.x === b2.x && a1.y === b2.y) ||
            (a2.x === b1.x && a2.y === b1.y) ||
            (a2.x === b2.x && a2.y === b2.y)
          ) {
            continue
          }
          if (doSegmentsIntersect(a1, a2, b1, b2)) {
            return true
          }
        }
      }
      return false
    }

    for (let i = 0; i < mlcpConnections.length; i++) {
      const connA = mlcpConnections[i]
      const pathA = connA.path!
      // Get intermediate nodes (exclude start and end)
      const intermediateA = new Set(
        pathA.slice(1, -1).map((n) => n.capacityMeshNodeId),
      )

      for (let j = i + 1; j < mlcpConnections.length; j++) {
        const connB = mlcpConnections[j]
        const pathB = connB.path!
        // Check if any intermediate node in A appears in B's path (excluding B's endpoints)
        const intermediateB = new Set(
          pathB.slice(1, -1).map((n) => n.capacityMeshNodeId),
        )

        // Check for shared nodes
        let hasConflict = false
        for (const nodeId of intermediateA) {
          if (pathB.some((n) => n.capacityMeshNodeId === nodeId)) {
            hasConflict = true
            break
          }
        }
        if (!hasConflict) {
          for (const nodeId of intermediateB) {
            if (pathA.some((n) => n.capacityMeshNodeId === nodeId)) {
              hasConflict = true
              break
            }
          }
        }

        // Also check for geometric crossing
        if (!hasConflict) {
          hasConflict = pathsCrossGeometrically(pathA, pathB)
        }

        if (hasConflict) {
          conflicts.get(connA.connection.name)!.add(connB.connection.name)
          conflicts.get(connB.connection.name)!.add(connA.connection.name)
        }
      }
    }

    // Check if a path can fully support a given layer
    const pathSupportsLayer = (path: CapacityMeshNode[], layer: number): boolean => {
      return path.every((node) => node.availableZ.includes(layer))
    }

    // Greedy graph coloring using ALL available layers (not just 2)
    // This handles non-bipartite conflict graphs (e.g., triangles)
    const colorAssignment = new Map<string, number>()
    const availableLayers = mlcpConnections[0].path![0].availableZ

    // Sort connections by number of conflicts (highest first) for better coloring
    const sortedConns = [...mlcpConnections].sort((a, b) => {
      const conflictsA = conflicts.get(a.connection.name)?.size ?? 0
      const conflictsB = conflicts.get(b.connection.name)?.size ?? 0
      return conflictsB - conflictsA
    })

    for (const conn of sortedConns) {
      const connName = conn.connection.name
      const conflictingConns = conflicts.get(connName)!
      const path = conn.path!

      // Find colors used by conflicting connections
      const usedColors = new Set<number>()
      for (const conflictName of conflictingConns) {
        if (colorAssignment.has(conflictName)) {
          usedColors.add(colorAssignment.get(conflictName)!)
        }
      }

      // Try each available layer, preferring ones not used by conflicts
      let assignedLayer: number | null = null
      for (const layer of availableLayers) {
        if (!usedColors.has(layer) && pathSupportsLayer(path, layer)) {
          assignedLayer = layer
          break
        }
      }

      // Fallback: pick first supported layer even if it conflicts
      if (assignedLayer === null) {
        for (const layer of availableLayers) {
          if (pathSupportsLayer(path, layer)) {
            assignedLayer = layer
            break
          }
        }
      }

      colorAssignment.set(connName, assignedLayer ?? availableLayers[0])
    }

    // Debug: log conflicts and assignments
    console.log("[MLCP Layer Assignment] Conflicts:", Object.fromEntries(
      [...conflicts.entries()].map(([name, conflictSet]) => [name, [...conflictSet]])
    ))
    console.log("[MLCP Layer Assignment] Assignments:", Object.fromEntries(colorAssignment))

    // Apply layer assignments
    for (const conn of mlcpConnections) {
      const layer = colorAssignment.get(conn.connection.name) ?? layer0
      conn.startZ = layer
      conn.endZ = layer
    }
  }

  _step() {
    const nextConnection =
      this.connectionsWithNodes[this.currentConnectionIndex]
    if (!nextConnection) {
      // All paths found - now assign layers to avoid MLCP crossings
      this.assignLayersToMLCPConnections()
      this.solved = true
      return
    }
    const [start, end] = nextConnection.nodes
    if (!this.candidates) {
      // For MLCP start nodes, create initial candidates for each available layer
      // This allows A* to optimize layer selection
      const startIsMLCP = start._isMultiLayerConnectionPoint
      const startLayers = startIsMLCP ? start.availableZ : [start.availableZ[0]]

      this.candidates = startLayers.map((z) => ({
        prevCandidate: null,
        node: start,
        f: 0,
        g: 0,
        h: 0,
        designatedZ: z,
      }))
      this.debug_lastNodeCostMap = new Map()
      // Track closed set (nodes we've already processed)
      this.visitedNodes = new Set<string>()
      // Track best g-cost seen for open set to avoid adding worse paths
      this.bestGCostMap = new Map(
        startLayers.map((z) => [`${start.capacityMeshNodeId}:${z}`, 0]),
      )
      this.activeCandidateStraightLineDistance = distance(
        start.center,
        end.center,
      )
    }

    this.candidates.sort((a, b) => a.f - b.f)
    let currentCandidate = this.candidates.shift()
    if (this.candidates.length > this.MAX_CANDIDATES_IN_MEMORY) {
      this.candidates.splice(
        this.MAX_CANDIDATES_IN_MEMORY,
        this.candidates.length - this.MAX_CANDIDATES_IN_MEMORY,
      )
    }
    // Skip candidates that have already been visited (closed set check)
    while (currentCandidate) {
      const currentZ = currentCandidate.designatedZ ?? currentCandidate.node.availableZ[0]
      const currentVisitedKey = `${currentCandidate.node.capacityMeshNodeId}:${currentZ}`
      if (!this.visitedNodes?.has(currentVisitedKey)) {
        break // Found an unvisited candidate
      }
      currentCandidate = this.candidates.shift()
    }
    if (!currentCandidate) {
      // TODO Track failed paths, make sure solver doesn't think it solved
      console.error(
        `Ran out of candidates on connection ${nextConnection.connection.name}`,
      )
      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      this.bestGCostMap = null
      this.failed = true
      return
    }
    // Mark current candidate as visited now that we're processing it
    const candidateZ = currentCandidate.designatedZ ?? currentCandidate.node.availableZ[0]
    this.visitedNodes!.add(`${currentCandidate.node.capacityMeshNodeId}:${candidateZ}`)
    // Check if we've reached the actual end node (not just a neighbor of it)
    if (currentCandidate.node.capacityMeshNodeId === end.capacityMeshNodeId) {
      // We've reached the end node - extract the path
      nextConnection.path = this.getBacktrackedPath(currentCandidate)

      // Extract startZ from the first candidate in the path (last in backtracked order)
      let startCandidate: Candidate | null = currentCandidate
      while (startCandidate?.prevCandidate) {
        startCandidate = startCandidate.prevCandidate
      }
      nextConnection.startZ = startCandidate?.designatedZ ?? start.availableZ[0]
      nextConnection.endZ = candidateZ

      this.reduceCapacityAlongPath(nextConnection)

      this.currentConnectionIndex++
      this.candidates = null
      this.visitedNodes = null
      this.bestGCostMap = null
      return
    }

    const neighborNodes = this.getNeighboringNodes(currentCandidate.node)
    const currentZ = currentCandidate.designatedZ ?? currentCandidate.node.availableZ[0]

    for (const neighborNode of neighborNodes) {
      // Determine the target layer for this neighbor
      // If current layer is available in neighbor, stay on it; otherwise need to transition
      const currentLayerAvailable = neighborNode.availableZ.includes(currentZ)
      const neighborIsMLCP = neighborNode._isMultiLayerConnectionPoint
      const endIsMLCP = end._isMultiLayerConnectionPoint

      // Determine target layer:
      // - If current layer is available, stay on it
      // - If neighbor is MLCP, any layer transition is free
      // - Otherwise, pick first available layer and add via penalty
      let targetZ: number
      let viaPenalty = 0

      if (currentLayerAvailable) {
        targetZ = currentZ
      } else if (neighborIsMLCP) {
        // MLCP allows free layer transition - pick the best available layer
        targetZ = neighborNode.availableZ[0]
      } else {
        // Need a via - pick first available layer and add penalty
        // Via penalty needs to be significant enough to overcome greedy A* inflation
        targetZ = neighborNode.availableZ[0]
        viaPenalty = this.hyperParameters.viaPenalty ?? 5
      }

      // Check capacity and obstacle constraints
      if (
        !this.doesNodeHaveCapacityForTrace(neighborNode, currentCandidate.node)
      ) {
        continue
      }
      const connectionName =
        this.connectionsWithNodes[this.currentConnectionIndex].connection.name
      if (
        neighborNode._containsObstacle &&
        !this.canTravelThroughObstacle(neighborNode, connectionName)
      ) {
        continue
      }
      const g = this.computeG(currentCandidate, neighborNode, end) + viaPenalty
      const h = this.computeH(currentCandidate, neighborNode, end)
      const f = g + h * this.GREEDY_MULTIPLIER

      this.debug_lastNodeCostMap.set(neighborNode.capacityMeshNodeId, {
        f,
        g,
        h,
      })

      // Only add this candidate if it has a better g-cost than what we've seen
      const nodeLayerKey = `${neighborNode.capacityMeshNodeId}:${targetZ}`
      const existingBestG = this.bestGCostMap?.get(nodeLayerKey)
      if (existingBestG !== undefined && g >= existingBestG) {
        continue // We already have a better or equal path to this (node, layer)
      }
      this.bestGCostMap?.set(nodeLayerKey, g)

      const newCandidate: Candidate = {
        prevCandidate: currentCandidate,
        node: neighborNode,
        f,
        g,
        h,
        designatedZ: targetZ,
      }
      this.candidates.push(newCandidate)
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Visualize each solved connection path (draw a line through each node's center)
    if (this.connectionsWithNodes) {
      for (let i = 0; i < this.connectionsWithNodes.length; i++) {
        const conn = this.connectionsWithNodes[i]
        if (conn.path && conn.path.length > 0) {
          const pathPoints = conn.path.map(
            ({ center: { x, y }, width, availableZ }) => ({
              // slight offset to allow viewing overlapping paths
              x: x + ((i % 10) + (i % 19)) * (0.005 * width),
              y: y + ((i % 10) + (i % 19)) * (0.005 * width),
              availableZ,
            }),
          )
          graphics.lines!.push({
            points: pathPoints,
            strokeColor: this.colorMap[conn.connection.name],
          })
          for (let u = 0; u < pathPoints.length; u++) {
            const point = pathPoints[u]
            graphics.points!.push({
              x: point.x,
              y: point.y,
              label: [
                `conn: ${conn.connection.name}`,
                `node: ${conn.path[u].capacityMeshNodeId}`,
                `z: ${point.availableZ.join(",")}`,
              ].join("\n"),
            })
          }
        }
      }
    }

    for (const node of this.nodes) {
      const usedCapacity =
        this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
      const totalCapacity = this.getTotalCapacity(node)
      const nodeCosts = this.debug_lastNodeCostMap.get(node.capacityMeshNodeId)
      graphics.rects!.push({
        ...createRectFromCapacityNode(node, {
          rectMargin: 0.025,
          zOffset: 0.01,
        }),
        label: [
          `${node.capacityMeshNodeId}`,
          `${usedCapacity}/${totalCapacity}`,
          `${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
          `g: ${nodeCosts?.g !== undefined ? nodeCosts.g.toFixed(2) : "?"}`,
          `h: ${nodeCosts?.h !== undefined ? nodeCosts.h.toFixed(2) : "?"}`,
          `f: ${nodeCosts?.f !== undefined ? nodeCosts.f.toFixed(2) : "?"}`,
          `z: ${node.availableZ.join(", ")}`,
        ].join("\n"),
        stroke: usedCapacity > totalCapacity + 0.5 ? "red" : undefined,
      })
    }

    // Visualize connection points from each connection as circles
    if (this.connectionsWithNodes) {
      for (const conn of this.connectionsWithNodes) {
        if (conn.connection?.pointsToConnect) {
          for (const point of conn.connection.pointsToConnect) {
            graphics.points!.push({
              x: point.x,
              y: point.y,
              label: [`pointsToConnect ${conn.connection.name}`].join("\n"),
            })
          }
        }
      }
    }

    // Draw a dashed line from the start node to the end node
    const nextConnection =
      this.connectionsWithNodes[this.currentConnectionIndex]

    // If we failed on the previous connection and haven't started the next one yet,
    // show the failed connection instead
    let connectionToVisualize = nextConnection
    if (
      !this.candidates &&
      this.currentConnectionIndex > 0 &&
      !this.connectionsWithNodes[this.currentConnectionIndex - 1].path
    ) {
      connectionToVisualize =
        this.connectionsWithNodes[this.currentConnectionIndex - 1]
    }

    if (connectionToVisualize) {
      const [start, end] = connectionToVisualize.connection.pointsToConnect
      graphics.lines!.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor: "red",
        strokeDash: "10 5",
      })
    }

    // Visualize backtracked path of highest ranked candidate
    if (this.candidates) {
      // Get top 10 candidates
      const topCandidates = this.candidates.slice(0, 5)
      const connectionName =
        this.connectionsWithNodes[this.currentConnectionIndex].connection.name

      // Add paths for each candidate with decreasing opacity
      topCandidates.forEach((candidate, index) => {
        const opacity = 0.5 * (1 - index / 5) // Opacity decreases from 0.5 to 0.05
        const backtrackedPath = this.getBacktrackedPath(candidate)
        graphics.lines!.push({
          points: backtrackedPath.map(({ center: { x, y } }) => ({ x, y })),
          strokeColor: safeTransparentize(
            this.colorMap[connectionName] ?? "red",
            1 - opacity,
          ),
        })
      })
    }

    return graphics
  }
}
