import { BaseSolver } from "../BaseSolver"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  Jumper,
} from "lib/types/high-density-types"
import {
  distance,
  pointToSegmentDistance,
  doSegmentsIntersect,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"

export type FutureConnection = {
  connectionName: string
  points: { x: number; y: number; z: number }[]
}

/**
 * 0805 footprint dimensions in mm
 * Actual 0805: 2.0mm x 1.25mm
 * We use slightly larger values for routing clearance
 */
const JUMPER_0805 = {
  length: 2.0, // mm (along the jumper direction)
  width: 1.25, // mm (perpendicular to jumper direction)
  padLength: 0.5, // mm (pad at each end)
  padWidth: 1.25, // mm
}

/**
 * Extended node type that tracks jumper usage
 */
type JumperNode = Node & {
  /** If this node was reached via a jumper, this contains jumper info */
  jumperEntry?: { x: number; y: number }
  /** Track if this movement is the exit of a jumper */
  isJumperExit?: boolean
  /** Count of jumpers used to reach this node */
  jumperCount?: number
}

export class SingleHighDensityRouteWithJumpersSolver extends BaseSolver {
  obstacleRoutes: HighDensityIntraNodeRouteWithJumpers[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  boundsSize: { width: number; height: number }
  boundsCenter: { x: number; y: number }
  A: { x: number; y: number; z: number }
  B: { x: number; y: number; z: number }
  straightLineDistance: number

  traceThickness: number
  obstacleMargin: number
  minCellSize = 0.05
  cellStep = 0.05
  GREEDY_MULTIPLER = 1.1
  numRoutes: number

  /** Penalty factor for using a jumper (relative to distance) */
  JUMPER_PENALTY_FACTOR = 0.5

  /** Future connection proximity parameters */
  FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = 2
  FUTURE_CONNECTION_PROXIMITY_VD = 10

  CELL_SIZE_FACTOR: number

  exploredNodes: Set<string>

  candidates: SingleRouteCandidatePriorityQueue<JumperNode>

  connectionName: string
  solvedPath: HighDensityIntraNodeRouteWithJumpers | null = null

  futureConnections: FutureConnection[]
  hyperParameters: Partial<HighDensityHyperParameters>

  connMap?: ConnectivityMap

  /** For debugging/animating the exploration */
  debug_exploredNodesOrdered: string[]
  debug_nodesTooCloseToObstacle: Set<string>
  debug_nodePathToParentIntersectsObstacle: Set<string>

  debugEnabled = true

  initialNodeGridOffset: { x: number; y: number }

  /** Existing jumpers that act as obstacles */
  existingJumpers: Jumper[]

  constructor(opts: {
    connectionName: string
    obstacleRoutes: HighDensityIntraNodeRouteWithJumpers[]
    minDistBetweenEnteringPoints: number
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
    traceThickness?: number
    obstacleMargin?: number
    futureConnections?: FutureConnection[]
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
  }) {
    super()
    this.bounds = opts.bounds
    this.connMap = opts.connMap
    this.hyperParameters = opts.hyperParameters ?? {}
    this.CELL_SIZE_FACTOR = this.hyperParameters.CELL_SIZE_FACTOR ?? 1
    this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR =
      this.hyperParameters.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR ?? 2
    this.FUTURE_CONNECTION_PROXIMITY_VD =
      this.hyperParameters.FUTURE_CONNECTION_PROXIMITY_VD ?? 10
    this.boundsSize = {
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
    }
    this.boundsCenter = {
      x: (this.bounds.minX + this.bounds.maxX) / 2,
      y: (this.bounds.minY + this.bounds.maxY) / 2,
    }
    this.connectionName = opts.connectionName
    this.obstacleRoutes = opts.obstacleRoutes
    this.A = { ...opts.A, z: 0 } // Single layer, always z=0
    this.B = { ...opts.B, z: 0 } // Single layer, always z=0
    this.traceThickness = opts.traceThickness ?? 0.15
    this.obstacleMargin = opts.obstacleMargin ?? 0.2
    this.exploredNodes = new Set()
    this.straightLineDistance = distance(this.A, this.B)
    this.futureConnections = opts.futureConnections ?? []
    this.MAX_ITERATIONS = 10e3

    this.debug_exploredNodesOrdered = []
    this.debug_nodesTooCloseToObstacle = new Set()
    this.debug_nodePathToParentIntersectsObstacle = new Set()
    this.numRoutes = this.obstacleRoutes.length + this.futureConnections.length

    // Collect all existing jumpers from obstacle routes
    this.existingJumpers = []
    for (const route of this.obstacleRoutes) {
      if (route.jumpers) {
        this.existingJumpers.push(...route.jumpers)
      }
    }

    const bestRowOrColumnCount = Math.ceil(5 * (this.numRoutes + 1))
    let numXCells = this.boundsSize.width / this.cellStep
    let numYCells = this.boundsSize.height / this.cellStep

    while (numXCells * numYCells > bestRowOrColumnCount ** 2) {
      if (this.cellStep * 2 > opts.minDistBetweenEnteringPoints) {
        break
      }
      this.cellStep *= 2
      numXCells = this.boundsSize.width / this.cellStep
      numYCells = this.boundsSize.height / this.cellStep
    }

    this.cellStep *= this.CELL_SIZE_FACTOR

    const isOnSameEdge =
      (Math.abs(this.A.x - this.bounds.minX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.minX) < 0.001) ||
      (Math.abs(this.A.x - this.bounds.maxX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.maxX) < 0.001) ||
      (Math.abs(this.A.y - this.bounds.minY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.minY) < 0.001) ||
      (Math.abs(this.A.y - this.bounds.maxY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.maxY) < 0.001)

    if (
      this.futureConnections &&
      this.futureConnections.length === 0 &&
      this.obstacleRoutes.length === 0 &&
      !isOnSameEdge
    ) {
      this.handleSimpleCases()
    }

    const initialNodePosition = {
      x: Math.round(opts.A.x / (this.cellStep / 2)) * (this.cellStep / 2),
      y: Math.round(opts.A.y / (this.cellStep / 2)) * (this.cellStep / 2),
    }
    this.initialNodeGridOffset = {
      x:
        initialNodePosition.x -
        Math.round(opts.A.x / this.cellStep) * this.cellStep,
      y:
        initialNodePosition.y -
        Math.round(opts.A.y / this.cellStep) * this.cellStep,
    }
    this.candidates = new SingleRouteCandidatePriorityQueue([
      {
        ...opts.A,
        ...initialNodePosition,
        z: 0,
        g: 0,
        h: 0,
        f: 0,
        jumperCount: 0,
        parent: {
          ...opts.A,
          z: 0,
          g: 0,
          h: 0,
          f: 0,
          parent: null,
        },
      },
    ])
  }

  handleSimpleCases() {
    this.solved = true
    const { A, B } = this
    this.solvedPath = {
      connectionName: this.connectionName,
      route: [
        { x: A.x, y: A.y, z: 0 },
        { x: B.x, y: B.y, z: 0 },
      ],
      traceThickness: this.traceThickness,
      jumpers: [],
    }
  }

  get jumperPenaltyDistance() {
    return (
      JUMPER_0805.length +
      this.straightLineDistance * this.JUMPER_PENALTY_FACTOR
    )
  }

  /**
   * Check if a node is too close to an obstacle trace or jumper
   */
  isNodeTooCloseToObstacle(node: JumperNode, margin?: number) {
    margin ??= this.obstacleMargin

    // Check against obstacle routes
    for (const route of this.obstacleRoutes) {
      const connectedToObstacle = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )

      if (!connectedToObstacle) {
        const pointPairs = getSameLayerPointPairs(route)
        for (const pointPair of pointPairs) {
          if (
            pointToSegmentDistance(node, pointPair.A, pointPair.B) <
            this.traceThickness + margin
          ) {
            return true
          }
        }
      }

      // Check against jumpers in this route
      for (const jumper of route.jumpers || []) {
        if (this.isNodeTooCloseToJumper(node, jumper, margin)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Check if a node is too close to a jumper component
   */
  isNodeTooCloseToJumper(
    node: { x: number; y: number },
    jumper: Jumper,
    margin: number,
  ): boolean {
    // Calculate jumper center and orientation
    const centerX = (jumper.start.x + jumper.end.x) / 2
    const centerY = (jumper.start.y + jumper.end.y) / 2
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y
    const length = Math.sqrt(dx * dx + dy * dy)

    // Normalize direction
    const dirX = dx / length
    const dirY = dy / length

    // Transform point to jumper's local coordinate system
    const localX = (node.x - centerX) * dirX + (node.y - centerY) * dirY
    const localY = -(node.x - centerX) * dirY + (node.y - centerY) * dirX

    // Check if point is within jumper bounds (with margin)
    const halfLength = JUMPER_0805.length / 2 + margin
    const halfWidth = JUMPER_0805.width / 2 + margin

    return Math.abs(localX) < halfLength && Math.abs(localY) < halfWidth
  }

  isNodeTooCloseToEdge(node: JumperNode) {
    const margin = this.obstacleMargin / 2
    const tooClose =
      node.x < this.bounds.minX + margin ||
      node.x > this.bounds.maxX - margin ||
      node.y < this.bounds.minY + margin ||
      node.y > this.bounds.maxY - margin
    if (tooClose) {
      if (
        distance(node, this.B) < margin * 2 ||
        distance(node, this.A) < margin * 2
      ) {
        return false
      }
    }
    return tooClose
  }

  doesPathToParentIntersectObstacle(node: JumperNode) {
    const parent = node.parent
    if (!parent) return false

    for (const route of this.obstacleRoutes) {
      const obstacleIsConnectedToNewPath = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (obstacleIsConnectedToNewPath) continue

      for (const pointPair of getSameLayerPointPairs(route)) {
        if (doSegmentsIntersect(node, parent, pointPair.A, pointPair.B)) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Find obstacles between current node and a target position
   * Returns the obstacle segment(s) that block the direct path
   */
  findObstaclesBetween(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Array<{ A: { x: number; y: number }; B: { x: number; y: number } }> {
    const obstacles: Array<{
      A: { x: number; y: number }
      B: { x: number; y: number }
    }> = []

    for (const route of this.obstacleRoutes) {
      const obstacleIsConnectedToNewPath = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (obstacleIsConnectedToNewPath) continue

      for (const pointPair of getSameLayerPointPairs(route)) {
        if (doSegmentsIntersect(from, to, pointPair.A, pointPair.B)) {
          obstacles.push({ A: pointPair.A, B: pointPair.B })
        }
      }
    }

    return obstacles
  }

  computeH(node: JumperNode) {
    return distance(node, this.B) + this.getFutureConnectionPenalty(node)
  }

  computeG(node: JumperNode) {
    const baseG = (node.parent?.g ?? 0) + distance(node, node.parent!)

    // Add jumper penalty if this node was reached via a jumper
    if (node.isJumperExit) {
      return (
        baseG +
        this.jumperPenaltyDistance +
        this.getFutureConnectionPenalty(node)
      )
    }

    return baseG + this.getFutureConnectionPenalty(node)
  }

  computeF(g: number, h: number) {
    return g + h * this.GREEDY_MULTIPLER
  }

  getClosestFutureConnectionPoint(node: JumperNode) {
    let minDist = Infinity
    let closestPoint = null

    for (const futureConnection of this.futureConnections) {
      for (const point of futureConnection.points) {
        const dist = distance(node, point)
        if (dist < minDist) {
          minDist = dist
          closestPoint = point
        }
      }
    }

    return closestPoint
  }

  getFutureConnectionPenalty(node: JumperNode) {
    let futureConnectionPenalty = 0
    const closestFuturePoint = this.getClosestFutureConnectionPoint(node)
    const goalDist = distance(node, this.B)
    if (closestFuturePoint) {
      const distToFuturePoint = distance(node, closestFuturePoint)
      if (goalDist <= distToFuturePoint) return 0
      const maxDist = this.traceThickness * this.FUTURE_CONNECTION_PROXIMITY_VD
      const distRatio = distToFuturePoint / maxDist
      const maxPenalty =
        this.straightLineDistance *
        this.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
      futureConnectionPenalty = maxPenalty * Math.exp(-distRatio * 5)
    }
    return futureConnectionPenalty
  }

  getNodeKey(node: JumperNode) {
    const jumperSuffix = node.isJumperExit ? "_j" : ""
    return `${Math.round(node.x / this.cellStep) * this.cellStep},${Math.round(node.y / this.cellStep) * this.cellStep},${node.z}${jumperSuffix}`
  }

  /**
   * Calculate potential jumper positions to cross an obstacle
   */
  getJumperNeighbors(node: JumperNode): JumperNode[] {
    const neighbors: JumperNode[] = []

    // Look for obstacles in various directions from current position
    const directions = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: 1 },
      { dx: -1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: -1 },
    ]

    for (const dir of directions) {
      // Check if there's an obstacle in this direction within jumper range
      const checkDist = JUMPER_0805.length * 2
      const targetX = node.x + dir.dx * checkDist
      const targetY = node.y + dir.dy * checkDist

      const obstacles = this.findObstaclesBetween(node, {
        x: targetX,
        y: targetY,
      })

      if (obstacles.length > 0) {
        // Calculate a jumper position that would clear the obstacle
        for (const obstacle of obstacles) {
          const jumperNeighbor = this.calculateJumperExit(node, obstacle, dir)
          if (
            jumperNeighbor &&
            !this.exploredNodes.has(this.getNodeKey(jumperNeighbor))
          ) {
            // Verify the jumper exit is valid
            if (
              !this.isNodeTooCloseToObstacle(jumperNeighbor) &&
              !this.isNodeTooCloseToEdge(jumperNeighbor) &&
              this.isJumperPlacementValid(node, jumperNeighbor)
            ) {
              jumperNeighbor.g = this.computeG(jumperNeighbor)
              jumperNeighbor.h = this.computeH(jumperNeighbor)
              jumperNeighbor.f = this.computeF(
                jumperNeighbor.g,
                jumperNeighbor.h,
              )
              neighbors.push(jumperNeighbor)
            }
          }
        }
      }
    }

    return neighbors
  }

  /**
   * Calculate the exit position for a jumper that clears an obstacle
   */
  calculateJumperExit(
    entry: JumperNode,
    obstacle: { A: { x: number; y: number }; B: { x: number; y: number } },
    direction: { dx: number; dy: number },
  ): JumperNode | null {
    // Calculate the jumper length needed to clear the obstacle
    const clearance = this.traceThickness + this.obstacleMargin
    const jumpDistance = JUMPER_0805.length + clearance * 2

    // Normalize direction
    const dirLength = Math.sqrt(
      direction.dx * direction.dx + direction.dy * direction.dy,
    )
    const normDx = direction.dx / dirLength
    const normDy = direction.dy / dirLength

    // Calculate exit position
    const exitX = entry.x + normDx * jumpDistance
    const exitY = entry.y + normDy * jumpDistance

    // Check bounds
    if (
      exitX < this.bounds.minX ||
      exitX > this.bounds.maxX ||
      exitY < this.bounds.minY ||
      exitY > this.bounds.maxY
    ) {
      return null
    }

    return {
      x: exitX,
      y: exitY,
      z: 0,
      parent: entry,
      g: 0,
      h: 0,
      f: 0,
      jumperEntry: { x: entry.x, y: entry.y },
      isJumperExit: true,
      jumperCount: (entry.jumperCount ?? 0) + 1,
    }
  }

  /**
   * Verify that a jumper placement is valid (doesn't overlap with existing jumpers)
   */
  isJumperPlacementValid(entry: JumperNode, exit: JumperNode): boolean {
    // Check that the jumper doesn't overlap with existing jumpers
    const proposedJumper: Jumper = {
      route_type: "jumper",
      start: { x: entry.x, y: entry.y },
      end: { x: exit.x, y: exit.y },
      footprint: "0805",
    }

    for (const existingJumper of this.existingJumpers) {
      if (this.doJumpersOverlap(proposedJumper, existingJumper)) {
        return false
      }
    }

    // Also check jumpers in the current path
    const pathJumpers = this.getJumpersInPath(entry)
    for (const pathJumper of pathJumpers) {
      if (this.doJumpersOverlap(proposedJumper, pathJumper)) {
        return false
      }
    }

    return true
  }

  /**
   * Check if two jumpers overlap
   */
  doJumpersOverlap(j1: Jumper, j2: Jumper): boolean {
    const margin = this.obstacleMargin

    // Simple bounding box check
    const j1MinX =
      Math.min(j1.start.x, j1.end.x) - JUMPER_0805.width / 2 - margin
    const j1MaxX =
      Math.max(j1.start.x, j1.end.x) + JUMPER_0805.width / 2 + margin
    const j1MinY =
      Math.min(j1.start.y, j1.end.y) - JUMPER_0805.width / 2 - margin
    const j1MaxY =
      Math.max(j1.start.y, j1.end.y) + JUMPER_0805.width / 2 + margin

    const j2MinX =
      Math.min(j2.start.x, j2.end.x) - JUMPER_0805.width / 2 - margin
    const j2MaxX =
      Math.max(j2.start.x, j2.end.x) + JUMPER_0805.width / 2 + margin
    const j2MinY =
      Math.min(j2.start.y, j2.end.y) - JUMPER_0805.width / 2 - margin
    const j2MaxY =
      Math.max(j2.start.y, j2.end.y) + JUMPER_0805.width / 2 + margin

    return !(
      j1MaxX < j2MinX ||
      j1MinX > j2MaxX ||
      j1MaxY < j2MinY ||
      j1MinY > j2MaxY
    )
  }

  /**
   * Get all jumpers in the path to a node
   */
  getJumpersInPath(node: JumperNode): Jumper[] {
    const jumpers: Jumper[] = []
    let current: JumperNode | null = node

    while (current && current.parent) {
      if (current.isJumperExit && current.jumperEntry) {
        jumpers.push({
          route_type: "jumper",
          start: current.jumperEntry,
          end: { x: current.x, y: current.y },
          footprint: "0805",
        })
      }
      current = current.parent as JumperNode
    }

    return jumpers
  }

  getNeighbors(node: JumperNode): JumperNode[] {
    const neighbors: JumperNode[] = []

    const { maxX, minX, maxY, minY } = this.bounds

    // Regular grid neighbors
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue

        const neighbor: JumperNode = {
          ...node,
          parent: node,
          x: clamp(node.x + x * this.cellStep, minX, maxX),
          y: clamp(node.y + y * this.cellStep, minY, maxY),
          isJumperExit: false,
          jumperEntry: undefined,
          jumperCount: node.jumperCount ?? 0,
        }

        const neighborKey = this.getNodeKey(neighbor)

        if (this.exploredNodes.has(neighborKey)) {
          continue
        }

        if (this.isNodeTooCloseToObstacle(neighbor)) {
          this.debug_nodesTooCloseToObstacle.add(neighborKey)
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (this.isNodeTooCloseToEdge(neighbor)) {
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (this.doesPathToParentIntersectObstacle(neighbor)) {
          this.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
          this.exploredNodes.add(neighborKey)
          continue
        }

        neighbor.g = this.computeG(neighbor)
        neighbor.h = this.computeH(neighbor)
        neighbor.f = this.computeF(neighbor.g, neighbor.h)

        neighbors.push(neighbor)
      }
    }

    // Add jumper neighbors if there are obstacles nearby
    const jumperNeighbors = this.getJumperNeighbors(node)
    neighbors.push(...jumperNeighbors)

    return neighbors
  }

  getNodePath(node: JumperNode): JumperNode[] {
    const path: JumperNode[] = []
    let current: JumperNode | null = node
    while (current) {
      path.push(current)
      current = current.parent as JumperNode | null
    }
    return path
  }

  setSolvedPath(node: JumperNode) {
    const path = this.getNodePath(node)
    path.reverse()

    const jumpers: Jumper[] = []
    for (let i = 0; i < path.length; i++) {
      const pathNode = path[i]
      if (pathNode.isJumperExit && pathNode.jumperEntry) {
        jumpers.push({
          route_type: "jumper",
          start: pathNode.jumperEntry,
          end: { x: pathNode.x, y: pathNode.y },
          footprint: "0805",
        })
      }
    }

    this.solvedPath = {
      connectionName: this.connectionName,
      traceThickness: this.traceThickness,
      route: path
        .map((n) => ({ x: n.x, y: n.y, z: 0 }))
        .concat([{ x: this.B.x, y: this.B.y, z: 0 }]),
      jumpers,
    }
  }

  computeProgress(currentNode: JumperNode, goalDist: number) {
    const goalDistPercent = 1 - goalDist / this.straightLineDistance

    return Math.max(
      this.progress || 0,
      (2 / Math.PI) *
        Math.atan((0.112 * goalDistPercent) / (1 - goalDistPercent)),
    )
  }

  _step() {
    let currentNode = this.candidates.dequeue() as JumperNode | null
    let currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined

    while (
      currentNode &&
      currentNodeKey &&
      this.exploredNodes.has(currentNodeKey)
    ) {
      currentNode = this.candidates.dequeue() as JumperNode | null
      currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined
    }

    if (!currentNode || !currentNodeKey) {
      this.failed = true
      this.error = "Ran out of candidate nodes to explore"
      return
    }
    this.exploredNodes.add(currentNodeKey)
    this.debug_exploredNodesOrdered.push(currentNodeKey)

    const goalDist = distance(currentNode, this.B)

    this.progress = this.computeProgress(currentNode, goalDist)

    if (
      goalDist <= this.cellStep * Math.SQRT2 &&
      !this.doesPathToParentIntersectObstacle({
        ...currentNode,
        parent: currentNode,
        x: this.B.x,
        y: this.B.y,
      } as JumperNode)
    ) {
      this.solved = true
      this.setSolvedPath(currentNode)
    }

    const neighbors = this.getNeighbors(currentNode)
    for (const neighbor of neighbors) {
      this.candidates.enqueue(neighbor)
    }
  }

  /**
   * Draw the two pads of an 0805 jumper
   */
  private drawJumperPads(
    graphics: GraphicsObject,
    jumper: Jumper,
    color: string,
    layer?: string,
    step?: number,
  ) {
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y
    const length = Math.sqrt(dx * dx + dy * dy)

    // Normalize direction
    const dirX = dx / length
    const dirY = dy / length

    // Perpendicular direction
    const perpX = -dirY
    const perpY = dirX

    const padLength = JUMPER_0805.padLength
    const padWidth = JUMPER_0805.padWidth

    // Start pad (two rectangles representing the actual pads)
    graphics.rects!.push({
      center: {
        x: jumper.start.x,
        y: jumper.start.y,
      },
      width: padLength,
      height: padWidth,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: layer ?? "jumper",
      step,
    })

    // End pad
    graphics.rects!.push({
      center: {
        x: jumper.end.x,
        y: jumper.end.y,
      },
      width: padLength,
      height: padWidth,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: layer ?? "jumper",
      step,
    })

    // Draw a line connecting the pads (representing the jumper body)
    graphics.lines!.push({
      points: [jumper.start, jumper.end],
      strokeColor: "rgba(100, 100, 100, 0.8)",
      strokeWidth: padWidth * 0.3,
      layer: layer ?? "jumper-body",
      step,
    })
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Display the input port points
    graphics.points!.push({
      x: this.A.x,
      y: this.A.y,
      label: `Input A\nz: ${this.A.z}`,
      color: "orange",
    })
    graphics.points!.push({
      x: this.B.x,
      y: this.B.y,
      label: `Input B\nz: ${this.B.z}`,
      color: "orange",
    })

    // Draw a line representing the direct connection
    graphics.lines!.push({
      points: [this.A, this.B],
      strokeColor: "rgba(255, 0, 0, 0.5)",
      label: "Direct Input Connection",
    })

    // Show obstacle routes
    for (
      let routeIndex = 0;
      routeIndex < this.obstacleRoutes.length;
      routeIndex++
    ) {
      const route = this.obstacleRoutes[routeIndex]
      for (let i = 0; i < route.route.length - 1; i++) {
        graphics.lines!.push({
          points: [route.route[i], route.route[i + 1]],
          strokeColor: "rgba(255, 0, 0, 0.75)",
          strokeWidth: route.traceThickness,
          label: "Obstacle Route",
          layer: `obstacle${routeIndex.toString()}`,
        })
      }

      // Draw obstacle jumpers
      for (const jumper of route.jumpers || []) {
        this.drawJumperPads(
          graphics,
          jumper,
          "rgba(255, 0, 0, 0.5)",
          `obstacle-jumper-${routeIndex}`,
        )
      }
    }

    // Visualize explored nodes
    for (let i = 0; i < this.debug_exploredNodesOrdered.length; i++) {
      const nodeKey = this.debug_exploredNodesOrdered[i]
      if (this.debug_nodesTooCloseToObstacle.has(nodeKey)) continue
      if (this.debug_nodePathToParentIntersectsObstacle.has(nodeKey)) continue

      const [x, y] = nodeKey.split(",").map(Number)
      const isJumperNode = nodeKey.endsWith("_j")

      graphics.rects!.push({
        center: {
          x: x + this.initialNodeGridOffset.x,
          y: y + this.initialNodeGridOffset.y,
        },
        fill: isJumperNode
          ? `rgba(0,255,255,${0.4 - (i / this.debug_exploredNodesOrdered.length) * 0.3})`
          : `rgba(255,0,255,${0.3 - (i / this.debug_exploredNodesOrdered.length) * 0.2})`,
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: isJumperNode ? "Explored (jumper)" : "Explored",
      })
    }

    // Visualize the next node to be explored
    if (this.candidates.peek()) {
      const nextNode = this.candidates.peek()!
      graphics.rects!.push({
        center: {
          x: nextNode.x,
          y: nextNode.y,
        },
        fill: "rgba(0, 255, 0, 0.8)",
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: "Next",
      })
    }

    // If a solved route exists, display it
    if (this.solvedPath) {
      graphics.lines!.push({
        points: this.solvedPath.route,
        strokeColor: "green",
        label: "Solved Route",
        strokeWidth: this.traceThickness,
      })

      // Draw solved jumpers
      for (const jumper of this.solvedPath.jumpers) {
        this.drawJumperPads(
          graphics,
          jumper,
          "rgba(0, 200, 0, 0.8)",
          "solved-jumper",
        )
      }
    }

    return graphics
  }
}

function getSameLayerPointPairs(route: HighDensityIntraNodeRouteWithJumpers) {
  const pointPairs: {
    z: number
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
  }[] = []

  for (let i = 0; i < route.route.length - 1; i++) {
    if (route.route[i].z === route.route[i + 1].z) {
      pointPairs.push({
        z: route.route[i].z,
        A: route.route[i],
        B: route.route[i + 1],
      })
    }
  }

  return pointPairs
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}
