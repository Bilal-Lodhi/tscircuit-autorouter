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
  GREEDY_MULTIPLER = 2
  numRoutes: number

  /** Penalty factor for using a jumper (relative to distance) */
  JUMPER_PENALTY_FACTOR = 0.1

  /** Future connection proximity parameters */
  FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR = 2
  FUTURE_CONNECTION_PROXIMITY_VD = 10

  /** Obstacle proximity penalty parameters (repulsive field) */
  OBSTACLE_PROX_PENALTY_FACTOR: number
  OBSTACLE_PROX_SIGMA: number

  /** Edge proximity penalty parameters */
  EDGE_PROX_PENALTY_FACTOR: number
  EDGE_PROX_SIGMA: number

  /** Whether to allow diagonal movement in pathfinding */
  ALLOW_DIAGONAL: boolean

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

    // Initialize obstacle proximity penalty parameters
    // These are "soft" penalties that prefer high-clearance paths but don't block routes
    this.OBSTACLE_PROX_PENALTY_FACTOR =
      this.hyperParameters.OBSTACLE_PROX_PENALTY_FACTOR ?? 4
    this.OBSTACLE_PROX_SIGMA =
      this.hyperParameters.OBSTACLE_PROX_SIGMA ??
      (opts.traceThickness ?? 0.15) * 20

    // Initialize edge proximity penalty parameters
    // Keep lower than obstacle penalty since edges are less problematic than trace collisions
    // and to avoid issues in tight spaces where start/end points are near edges
    this.EDGE_PROX_PENALTY_FACTOR =
      this.hyperParameters.EDGE_PROX_PENALTY_FACTOR ?? 4
    this.EDGE_PROX_SIGMA =
      this.hyperParameters.EDGE_PROX_SIGMA ?? (opts.traceThickness ?? 0.15) * 10

    // Initialize diagonal movement setting
    this.ALLOW_DIAGONAL = this.hyperParameters.ALLOW_DIAGONAL ?? false

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
   * Check if a node is too close to a jumper's pads
   * Traces CAN route under the body of the jumper, just not under the pads
   */
  isNodeTooCloseToJumper(
    node: { x: number; y: number },
    jumper: Jumper,
    margin: number,
  ): boolean {
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    // Determine if jumper is horizontal or vertical for pad dimensions
    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const padHalfWidth =
      (isHorizontal ? JUMPER_0805.padLength : JUMPER_0805.padWidth) / 2 + margin
    const padHalfHeight =
      (isHorizontal ? JUMPER_0805.padWidth : JUMPER_0805.padLength) / 2 + margin

    // Check against start pad
    if (
      Math.abs(node.x - jumper.start.x) < padHalfWidth &&
      Math.abs(node.y - jumper.start.y) < padHalfHeight
    ) {
      return true
    }

    // Check against end pad
    if (
      Math.abs(node.x - jumper.end.x) < padHalfWidth &&
      Math.abs(node.y - jumper.end.y) < padHalfHeight
    ) {
      return true
    }

    return false
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

      // Check if path crosses any jumper pads (but can pass under jumper body)
      for (const jumper of route.jumpers || []) {
        if (this.doesSegmentIntersectJumperPads(node, parent, jumper)) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Check if a line segment intersects with a jumper's pads
   * Segments CAN pass under the jumper body, just not through the pads
   */
  doesSegmentIntersectJumperPads(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    jumper: Jumper,
  ): boolean {
    const margin = this.obstacleMargin
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    // Determine if jumper is horizontal or vertical for pad dimensions
    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const padHalfWidth =
      (isHorizontal ? JUMPER_0805.padLength : JUMPER_0805.padWidth) / 2 + margin
    const padHalfHeight =
      (isHorizontal ? JUMPER_0805.padWidth : JUMPER_0805.padLength) / 2 + margin

    // Check intersection with start pad
    if (
      this.doesSegmentIntersectRect(
        p1,
        p2,
        jumper.start,
        padHalfWidth,
        padHalfHeight,
      )
    ) {
      return true
    }

    // Check intersection with end pad
    if (
      this.doesSegmentIntersectRect(
        p1,
        p2,
        jumper.end,
        padHalfWidth,
        padHalfHeight,
      )
    ) {
      return true
    }

    return false
  }

  /**
   * Check if a line segment intersects with an axis-aligned rectangle
   */
  doesSegmentIntersectRect(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    center: { x: number; y: number },
    halfWidth: number,
    halfHeight: number,
  ): boolean {
    const minX = center.x - halfWidth
    const maxX = center.x + halfWidth
    const minY = center.y - halfHeight
    const maxY = center.y + halfHeight

    // Check if either endpoint is inside the rectangle
    if (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY)
      return true
    if (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)
      return true

    // Check if line segment intersects any of the rectangle's edges
    const rectEdges = [
      { A: { x: minX, y: minY }, B: { x: maxX, y: minY } }, // bottom
      { A: { x: maxX, y: minY }, B: { x: maxX, y: maxY } }, // right
      { A: { x: maxX, y: maxY }, B: { x: minX, y: maxY } }, // top
      { A: { x: minX, y: maxY }, B: { x: minX, y: minY } }, // left
    ]

    for (const edge of rectEdges) {
      if (doSegmentsIntersect(p1, p2, edge.A, edge.B)) {
        return true
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
    // Include a smaller portion of density penalties in H to help "pull away" earlier
    const densityPenaltyInH =
      0.25 *
      (this.getObstacleProximityPenalty(node) +
        this.getEdgeProximityPenalty(node))
    return (
      distance(node, this.B) +
      this.getFutureConnectionPenalty(node) +
      densityPenaltyInH
    )
  }

  computeG(node: JumperNode) {
    const baseG = (node.parent?.g ?? 0) + distance(node, node.parent!)

    // Density penalty to push routes away from obstacles/edges
    const densityPenalty =
      this.getObstacleProximityPenalty(node) +
      this.getEdgeProximityPenalty(node) +
      this.getFutureConnectionPenalty(node)

    // Add jumper penalty if this node was reached via a jumper
    if (node.isJumperExit) {
      return baseG + this.jumperPenaltyDistance + densityPenalty
    }

    return baseG + densityPenalty
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

  /**
   * Compute the minimum distance from a node to any obstacle (trace segments and jumper pads)
   */
  getClearanceToObstacles(node: { x: number; y: number }): number {
    let minD = Infinity

    for (const route of this.obstacleRoutes) {
      const connected = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (connected) continue

      // Check distance to trace segments
      for (const seg of getSameLayerPointPairs(route)) {
        minD = Math.min(minD, pointToSegmentDistance(node, seg.A, seg.B))
      }

      // Jumper pads are solid obstacles
      for (const j of route.jumpers || []) {
        minD = Math.min(minD, this.distanceToJumperPads(node, j))
      }
    }

    return minD
  }

  /**
   * Compute distance from a point to the nearest jumper pad
   */
  distanceToJumperPads(p: { x: number; y: number }, j: Jumper): number {
    const dx = j.end.x - j.start.x
    const dy = j.end.y - j.start.y
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    const padHalfW =
      (isHorizontal ? JUMPER_0805.padLength : JUMPER_0805.padWidth) / 2
    const padHalfH =
      (isHorizontal ? JUMPER_0805.padWidth : JUMPER_0805.padLength) / 2

    return Math.min(
      this.pointToRectDistance(p, j.start, padHalfW, padHalfH),
      this.pointToRectDistance(p, j.end, padHalfW, padHalfH),
    )
  }

  /**
   * Compute distance from a point to an axis-aligned rectangle (0 if inside)
   */
  pointToRectDistance(
    p: { x: number; y: number },
    c: { x: number; y: number },
    halfW: number,
    halfH: number,
  ): number {
    const dx = Math.max(Math.abs(p.x - c.x) - halfW, 0)
    const dy = Math.max(Math.abs(p.y - c.y) - halfH, 0)
    return Math.hypot(dx, dy)
  }

  /**
   * Compute minimum distance from a node to the nearest boundary edge
   */
  getClearanceToEdge(node: { x: number; y: number }): number {
    return Math.min(
      node.x - this.bounds.minX,
      this.bounds.maxX - node.x,
      node.y - this.bounds.minY,
      this.bounds.maxY - node.y,
    )
  }

  /**
   * Compute the obstacle proximity penalty (repulsive field)
   * Returns a high value near obstacles, ~0 far away
   */
  getObstacleProximityPenalty(node: JumperNode): number {
    const c = this.getClearanceToObstacles(node)

    // Treat "effective clearance" relative to trace thickness + margin
    const effective = Math.max(
      0,
      c - (this.traceThickness + this.obstacleMargin),
    )

    // Repulsive potential: big near obstacles, tiny far away
    const sigma = this.OBSTACLE_PROX_SIGMA
    return this.OBSTACLE_PROX_PENALTY_FACTOR * Math.exp(-effective / sigma)
  }

  /**
   * Compute the edge proximity penalty (repulsive field near boundaries)
   * Returns a high value near edges, ~0 far away
   */
  getEdgeProximityPenalty(node: JumperNode): number {
    const c = this.getClearanceToEdge(node)
    const sigma = this.EDGE_PROX_SIGMA
    return this.EDGE_PROX_PENALTY_FACTOR * Math.exp(-c / sigma)
  }

  getNodeKey(node: JumperNode) {
    const jumperSuffix = node.isJumperExit ? "_j" : ""
    return `${Math.floor(node.x / this.cellStep) * this.cellStep},${Math.floor(node.y / this.cellStep) * this.cellStep},${node.z}${jumperSuffix}`
  }

  /**
   * Calculate potential jumper positions to cross an obstacle
   */
  getJumperNeighbors(node: JumperNode): JumperNode[] {
    const neighbors: JumperNode[] = []

    // Look for obstacles in horizontal and vertical directions only
    // (jumpers must be arranged horizontally or vertically)
    const directions = [
      { dx: 1, dy: 0 }, // right (horizontal)
      { dx: -1, dy: 0 }, // left (horizontal)
      { dx: 0, dy: 1 }, // up (vertical)
      { dx: 0, dy: -1 }, // down (vertical)
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
   * Check if a jumper's pads are too close to obstacle traces
   */
  isJumperTooCloseToTraces(
    entry: { x: number; y: number },
    exit: { x: number; y: number },
  ): boolean {
    const dx = exit.x - entry.x
    const dy = exit.y - entry.y
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    // Get pad dimensions based on jumper orientation
    const padHalfWidth =
      (isHorizontal ? JUMPER_0805.padLength : JUMPER_0805.padWidth) / 2
    const padHalfHeight =
      (isHorizontal ? JUMPER_0805.padWidth : JUMPER_0805.padLength) / 2
    const margin = this.obstacleMargin

    // Check both entry and exit pad positions against all obstacle traces
    const padCenters = [entry, exit]

    for (const padCenter of padCenters) {
      // Check each corner and edge midpoint of the pad for proximity to traces
      const checkPoints = [
        padCenter, // center
        { x: padCenter.x - padHalfWidth, y: padCenter.y - padHalfHeight }, // corners
        { x: padCenter.x + padHalfWidth, y: padCenter.y - padHalfHeight },
        { x: padCenter.x - padHalfWidth, y: padCenter.y + padHalfHeight },
        { x: padCenter.x + padHalfWidth, y: padCenter.y + padHalfHeight },
        { x: padCenter.x - padHalfWidth, y: padCenter.y }, // edge midpoints
        { x: padCenter.x + padHalfWidth, y: padCenter.y },
        { x: padCenter.x, y: padCenter.y - padHalfHeight },
        { x: padCenter.x, y: padCenter.y + padHalfHeight },
      ]

      for (const route of this.obstacleRoutes) {
        const connectedToObstacle = this.connMap?.areIdsConnected?.(
          this.connectionName,
          route.connectionName,
        )
        if (connectedToObstacle) continue

        const pointPairs = getSameLayerPointPairs(route)
        for (const pointPair of pointPairs) {
          // Check if any check point is too close to the trace segment
          for (const checkPoint of checkPoints) {
            if (
              pointToSegmentDistance(checkPoint, pointPair.A, pointPair.B) <
              this.traceThickness + margin
            ) {
              return true
            }
          }

          // Also check if the trace segment passes through the pad rectangle
          if (
            this.doesSegmentIntersectRect(
              pointPair.A,
              pointPair.B,
              padCenter,
              padHalfWidth + margin,
              padHalfHeight + margin,
            )
          ) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Verify that a jumper placement is valid (doesn't overlap with existing jumpers or traces)
   */
  isJumperPlacementValid(entry: JumperNode, exit: JumperNode): boolean {
    // Check that jumper pads aren't too close to existing traces
    if (this.isJumperTooCloseToTraces(entry, exit)) {
      return false
    }

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

        // Skip diagonal moves if not allowed
        if (!this.ALLOW_DIAGONAL && x !== 0 && y !== 0) continue

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
   * Pad dimensions are rotated based on jumper orientation
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

    const padLength = JUMPER_0805.padLength
    const padWidth = JUMPER_0805.padWidth

    // Determine if jumper is horizontal or vertical
    // Horizontal: dx != 0, dy ~= 0 -> pads are taller than wide (width=padLength, height=padWidth)
    // Vertical: dx ~= 0, dy != 0 -> pads are wider than tall (width=padWidth, height=padLength)
    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const rectWidth = isHorizontal ? padLength : padWidth
    const rectHeight = isHorizontal ? padWidth : padLength

    // Start pad
    graphics.rects!.push({
      center: {
        x: jumper.start.x,
        y: jumper.start.y,
      },
      width: rectWidth,
      height: rectHeight,
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
      width: rectWidth,
      height: rectHeight,
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
      const A = route.route[i]
      const B = route.route[i + 1]

      // Check if this segment is covered by a jumper
      // If so, skip it because the actual connection is elevated via the jumper
      // and traces can pass underneath
      const isCoveredByJumper = route.jumpers?.some((jumper) => {
        const matchesForward =
          Math.abs(jumper.start.x - A.x) < 0.001 &&
          Math.abs(jumper.start.y - A.y) < 0.001 &&
          Math.abs(jumper.end.x - B.x) < 0.001 &&
          Math.abs(jumper.end.y - B.y) < 0.001
        const matchesReverse =
          Math.abs(jumper.start.x - B.x) < 0.001 &&
          Math.abs(jumper.start.y - B.y) < 0.001 &&
          Math.abs(jumper.end.x - A.x) < 0.001 &&
          Math.abs(jumper.end.y - A.y) < 0.001
        return matchesForward || matchesReverse
      })

      if (!isCoveredByJumper) {
        pointPairs.push({
          z: A.z,
          A,
          B,
        })
      }
    }
  }

  return pointPairs
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}
