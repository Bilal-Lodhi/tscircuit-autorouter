import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  Jumper,
  NodeWithPortPoints,
  PortPoint,
} from "../../types/high-density-types"
import { safeTransparentize } from "../colors"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  type JumperFootprint,
  JUMPER_DIMENSIONS,
} from "../../utils/jumperSizes"
import {
  JumperGraphSolver,
  generateJumperX4Grid,
  createGraphWithConnectionsFromBaseGraph,
} from "@tscircuit/hypergraph"

export type HyperGraphPatternType = "single_1206x4" | "2x2_1206x4"

export interface JumperPrepatternSolver2HyperParameters {
  /** Pattern type for jumper placement - "single_1206x4" (~8x8mm) or "2x2_1206x4" (~14x14mm) */
  PATTERN_TYPE?: HyperGraphPatternType
  /** Orientation of jumpers - "horizontal" or "vertical" */
  ORIENTATION?: "horizontal" | "vertical"
}

export interface JumperPrepatternSolver2Params {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  hyperParameters?: JumperPrepatternSolver2HyperParameters
  connMap?: ConnectivityMap
}

interface XYConnection {
  start: { x: number; y: number }
  end: { x: number; y: number }
  connectionId: string
  // Original port points (on node boundary) before projection to graph boundary
  originalStart: { x: number; y: number }
  originalEnd: { x: number; y: number }
}

export class JumperPrepatternSolver2_HyperGraph extends BaseSolver {
  // Input parameters
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  hyperParameters: JumperPrepatternSolver2HyperParameters

  // Internal solver
  jumperGraphSolver: JumperGraphSolver | null = null
  xyConnections: XYConnection[] = []

  // Graph bounds for visualization
  graphBounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null = null

  // Output
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []

  constructor(params: JumperPrepatternSolver2Params) {
    super()
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.hyperParameters = params.hyperParameters ?? {}
    this.MAX_ITERATIONS = 1e6

    // Initialize colorMap if not provided
    if (Object.keys(this.colorMap).length === 0) {
      this.colorMap = this._buildColorMap()
    }
  }

  private _buildColorMap(): Record<string, string> {
    const colors = [
      "#e6194b",
      "#3cb44b",
      "#ffe119",
      "#4363d8",
      "#f58231",
      "#911eb4",
      "#46f0f0",
      "#f032e6",
      "#bcf60c",
      "#fabebe",
    ]
    const colorMap: Record<string, string> = {}
    const connectionNames = new Set<string>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      connectionNames.add(pp.connectionName)
    }
    let i = 0
    for (const name of Array.from(connectionNames)) {
      colorMap[name] = colors[i % colors.length]
      i++
    }
    return colorMap
  }

  private _getPatternConfig(): { cols: number; rows: number } {
    const patternType = this.hyperParameters.PATTERN_TYPE ?? "single_1206x4"
    if (patternType === "2x2_1206x4") {
      return { cols: 2, rows: 2 }
    }
    return { cols: 1, rows: 1 }
  }

  private _initializeGraph(): boolean {
    const node = this.nodeWithPortPoints
    const patternConfig = this._getPatternConfig()
    const orientation = this.hyperParameters.ORIENTATION ?? "vertical"

    // Generate the base jumper grid centered on the node
    const baseGraph = generateJumperX4Grid({
      cols: patternConfig.cols,
      rows: patternConfig.rows,
      marginX: 0.4,
      marginY: 0.4,
      outerPaddingX: 2,
      outerPaddingY: 2,
      innerColChannelPointCount: 3,
      innerRowChannelPointCount: 3,
      outerChannelXPointCount: 5,
      outerChannelYPointCount: 5,
      regionsBetweenPads: true,
      orientation,
      center: node.center,
    })

    // Calculate graph bounds
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const region of baseGraph.regions) {
      const bounds = region.d.bounds
      minX = Math.min(minX, bounds.minX)
      maxX = Math.max(maxX, bounds.maxX)
      minY = Math.min(minY, bounds.minY)
      maxY = Math.max(maxY, bounds.maxY)
    }
    this.graphBounds = { minX, maxX, minY, maxY }

    // Build connections from port points
    // Group port points by connection name
    const connectionMap = new Map<
      string,
      { points: PortPoint[]; rootConnectionName?: string }
    >()
    for (const pp of node.portPoints) {
      const existing = connectionMap.get(pp.connectionName)
      if (existing) {
        existing.points.push(pp)
      } else {
        connectionMap.set(pp.connectionName, {
          points: [pp],
          rootConnectionName: pp.rootConnectionName,
        })
      }
    }

    // Collect all port points that will be used in connections
    const allUsedPortPoints: PortPoint[] = []
    for (const [, data] of Array.from(connectionMap.entries())) {
      if (data.points.length >= 2) {
        allUsedPortPoints.push(data.points[0], data.points[1])
      }
    }

    // Project all port points together to spread them out along edges
    const projectedPositions = this._projectAllPortPoints(allUsedPortPoints)

    // Create XY connections - each connection needs start and end points on the boundary
    this.xyConnections = []
    for (const [connectionName, data] of Array.from(connectionMap.entries())) {
      if (data.points.length < 2) continue

      // For each pair of points in the connection, we need to route them
      // Store both the original positions (on node boundary) and projected positions (on graph boundary)
      const originalStart = { x: data.points[0].x, y: data.points[0].y }
      const originalEnd = { x: data.points[1].x, y: data.points[1].y }
      const start =
        projectedPositions.get(data.points[0]) ??
        this._projectToGraphBoundary(data.points[0])
      const end =
        projectedPositions.get(data.points[1]) ??
        this._projectToGraphBoundary(data.points[1])

      this.xyConnections.push({
        start,
        end,
        connectionId: connectionName,
        originalStart,
        originalEnd,
      })
    }

    if (this.xyConnections.length === 0) {
      this.solved = true
      return true
    }

    // Create graph with connections
    const graphWithConnections = createGraphWithConnectionsFromBaseGraph(
      baseGraph,
      this.xyConnections,
    )

    // Create the JumperGraphSolver
    this.jumperGraphSolver = new JumperGraphSolver({
      inputGraph: {
        regions: graphWithConnections.regions,
        ports: graphWithConnections.ports,
      },
      inputConnections: graphWithConnections.connections,
    })

    return true
  }

  /**
   * Determine which edge of the graph a port point should project to
   */
  private _getTargetEdge(pp: PortPoint): "left" | "right" | "top" | "bottom" {
    if (!this.graphBounds) return "left"

    const { minX, maxX, minY, maxY } = this.graphBounds

    const distLeft = Math.abs(pp.x - minX)
    const distRight = Math.abs(pp.x - maxX)
    const distTop = Math.abs(pp.y - maxY)
    const distBottom = Math.abs(pp.y - minY)

    const minDist = Math.min(distLeft, distRight, distTop, distBottom)

    if (minDist === distLeft) return "left"
    if (minDist === distRight) return "right"
    if (minDist === distTop) return "top"
    return "bottom"
  }

  /**
   * Project all port points to the graph boundary, spreading them out along each edge
   * to maximize spacing and avoid bunching at corners.
   */
  private _projectAllPortPoints(
    portPoints: PortPoint[],
  ): Map<PortPoint, { x: number; y: number }> {
    const result = new Map<PortPoint, { x: number; y: number }>()

    if (!this.graphBounds || portPoints.length === 0) {
      for (const pp of portPoints) {
        result.set(pp, { x: pp.x, y: pp.y })
      }
      return result
    }

    const { minX, maxX, minY, maxY } = this.graphBounds
    const padding = 0.5 // Padding from corners

    // Group port points by their target edge
    const edgeGroups: Record<string, PortPoint[]> = {
      left: [],
      right: [],
      top: [],
      bottom: [],
    }

    for (const pp of portPoints) {
      const edge = this._getTargetEdge(pp)
      edgeGroups[edge].push(pp)
    }

    // Process each edge - sort by position and spread evenly
    // Left edge: sort by Y (top to bottom)
    edgeGroups.left.sort((a, b) => b.y - a.y)
    this._spreadPointsAlongEdge(
      edgeGroups.left,
      result,
      "left",
      minX,
      minY + padding,
      maxY - padding,
    )

    // Right edge: sort by Y (top to bottom)
    edgeGroups.right.sort((a, b) => b.y - a.y)
    this._spreadPointsAlongEdge(
      edgeGroups.right,
      result,
      "right",
      maxX,
      minY + padding,
      maxY - padding,
    )

    // Top edge: sort by X (left to right)
    edgeGroups.top.sort((a, b) => a.x - b.x)
    this._spreadPointsAlongEdge(
      edgeGroups.top,
      result,
      "top",
      maxY,
      minX + padding,
      maxX - padding,
    )

    // Bottom edge: sort by X (left to right)
    edgeGroups.bottom.sort((a, b) => a.x - b.x)
    this._spreadPointsAlongEdge(
      edgeGroups.bottom,
      result,
      "bottom",
      minY,
      minX + padding,
      maxX - padding,
    )

    return result
  }

  /**
   * Spread points evenly along an edge
   */
  private _spreadPointsAlongEdge(
    points: PortPoint[],
    result: Map<PortPoint, { x: number; y: number }>,
    edge: "left" | "right" | "top" | "bottom",
    fixedCoord: number,
    rangeMin: number,
    rangeMax: number,
  ) {
    if (points.length === 0) return

    const rangeLength = rangeMax - rangeMin

    if (points.length === 1) {
      // Single point: place at center of range
      const center = rangeMin + rangeLength / 2
      if (edge === "left" || edge === "right") {
        result.set(points[0], { x: fixedCoord, y: center })
      } else {
        result.set(points[0], { x: center, y: fixedCoord })
      }
      return
    }

    // Multiple points: spread evenly along the range
    const spacing = rangeLength / (points.length - 1)

    for (let i = 0; i < points.length; i++) {
      const pos = rangeMin + i * spacing
      if (edge === "left" || edge === "right") {
        // For vertical edges, pos is Y coordinate (spread from top to bottom)
        // Reverse the order so highest Y is at rangeMax
        const reversedPos = rangeMax - i * spacing
        result.set(points[i], { x: fixedCoord, y: reversedPos })
      } else {
        // For horizontal edges, pos is X coordinate
        result.set(points[i], { x: pos, y: fixedCoord })
      }
    }
  }

  /**
   * Project a single port point to the graph boundary (for cases where we don't have all points)
   */
  private _projectToGraphBoundary(pp: PortPoint): { x: number; y: number } {
    if (!this.graphBounds) {
      return { x: pp.x, y: pp.y }
    }

    const { minX, maxX, minY, maxY } = this.graphBounds
    const edge = this._getTargetEdge(pp)

    // Clamp to graph bounds with some padding
    const padding = 0.5
    const clampedY = Math.max(minY + padding, Math.min(maxY - padding, pp.y))
    const clampedX = Math.max(minX + padding, Math.min(maxX - padding, pp.x))

    switch (edge) {
      case "left":
        return { x: minX, y: clampedY }
      case "right":
        return { x: maxX, y: clampedY }
      case "top":
        return { x: clampedX, y: maxY }
      case "bottom":
        return { x: clampedX, y: minY }
    }
  }

  _step() {
    // Initialize on first step
    if (!this.jumperGraphSolver) {
      this._initializeGraph()
      if (this.solved) return
      if (!this.jumperGraphSolver) {
        this.error = "Failed to initialize hypergraph solver"
        this.failed = true
        return
      }
    }

    // Step the internal solver
    this.jumperGraphSolver.step()

    if (this.jumperGraphSolver.solved) {
      this._processResults()
      this.solved = true
    } else if (this.jumperGraphSolver.failed) {
      this.error = this.jumperGraphSolver.error
      this.failed = true
    }
  }

  private _processResults() {
    if (!this.jumperGraphSolver) return

    // Track which throughjumpers have been used to avoid duplicates
    const usedThroughJumpers = new Set<string>()

    // Convert solved routes from HyperGraph format to HighDensityIntraNodeRouteWithJumpers
    for (const solvedRoute of this.jumperGraphSolver.solvedRoutes) {
      const connectionId = solvedRoute.connection.connectionId

      // Find the original connection info to get entry/exit points
      const xyConn = this.xyConnections.find(
        (c) => c.connectionId === connectionId,
      )

      // Extract route points from the solved path
      const routePoints: Array<{ x: number; y: number; z: number }> = []
      const jumpers: Jumper[] = []

      // Add entry segment: from original port point to graph boundary
      if (xyConn) {
        routePoints.push({
          x: xyConn.originalStart.x,
          y: xyConn.originalStart.y,
          z: 0,
        })
      }

      for (const candidate of solvedRoute.path) {
        const port = candidate.port as any
        const point = { x: port.d.x, y: port.d.y, z: 0 }
        routePoints.push(point)

        // Check if we crossed through a jumper (lastRegion is a throughjumper)
        const region = candidate.lastRegion as any
        if (
          region?.d?.isThroughJumper &&
          !usedThroughJumpers.has(region.regionId)
        ) {
          usedThroughJumpers.add(region.regionId)

          // Use the throughjumper region's bounds to get the correct pad positions
          // For 1206x4 horizontal jumpers:
          // - minX is left pad center X, maxX is right pad center X
          // - center.y is the row's Y position
          const bounds = region.d.bounds
          const centerY = region.d.center.y

          jumpers.push({
            route_type: "jumper",
            start: { x: bounds.minX, y: centerY },
            end: { x: bounds.maxX, y: centerY },
            footprint: "1206x4_pair",
          })
        }
      }

      // Add exit segment: from graph boundary to original port point
      if (xyConn) {
        routePoints.push({
          x: xyConn.originalEnd.x,
          y: xyConn.originalEnd.y,
          z: 0,
        })
      }

      // Find the root connection name from our input
      const rootConnectionName = this.nodeWithPortPoints.portPoints.find(
        (pp) => pp.connectionName === connectionId,
      )?.rootConnectionName

      this.solvedRoutes.push({
        connectionName: connectionId,
        rootConnectionName,
        traceThickness: this.traceWidth,
        route: routePoints,
        jumpers,
      })
    }
  }

  getOutput(): HighDensityIntraNodeRouteWithJumpers[] {
    return this.solvedRoutes
  }

  visualize(): GraphicsObject {
    if (this.jumperGraphSolver && !this.solved) {
      return this.jumperGraphSolver.visualize()
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    const node = this.nodeWithPortPoints
    const bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }

    // Draw node boundary
    graphics.lines!.push({
      points: [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    // Draw port points
    for (const pp of node.portPoints) {
      graphics.points!.push({
        x: pp.x,
        y: pp.y,
        label: pp.connectionName,
        color: this.colorMap[pp.connectionName] ?? "blue",
      })
    }

    // Draw solved routes
    for (const route of this.solvedRoutes) {
      const color = this.colorMap[route.connectionName] ?? "blue"

      for (let i = 0; i < route.route.length - 1; i++) {
        const p1 = route.route[i]
        const p2 = route.route[i + 1]

        graphics.lines!.push({
          points: [p1, p2],
          strokeColor: safeTransparentize(color, 0.2),
          strokeWidth: route.traceThickness,
          layer: "route-layer-0",
        })
      }

      // Draw jumpers
      for (const jumper of route.jumpers) {
        this._drawJumperPads(graphics, jumper, safeTransparentize(color, 0.5))
      }
    }

    return graphics
  }

  private _drawJumperPads(
    graphics: GraphicsObject,
    jumper: Jumper,
    color: string,
  ) {
    const dims = JUMPER_DIMENSIONS[jumper.footprint]
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const rectWidth = isHorizontal ? dims.padLength : dims.padWidth
    const rectHeight = isHorizontal ? dims.padWidth : dims.padLength

    graphics.rects!.push({
      center: { x: jumper.start.x, y: jumper.start.y },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    graphics.rects!.push({
      center: { x: jumper.end.x, y: jumper.end.y },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    graphics.lines!.push({
      points: [jumper.start, jumper.end],
      strokeColor: "rgba(100, 100, 100, 0.8)",
      strokeWidth: dims.padWidth * 0.3,
      layer: "jumper-body",
    })
  }
}
