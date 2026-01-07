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
import { type JumperFootprint, JUMPER_DIMENSIONS } from "../../utils/jumperSizes"
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
      marginX: 1.2,
      marginY: 1.2,
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

    // Create XY connections - each connection needs start and end points on the boundary
    this.xyConnections = []
    for (const [connectionName, data] of Array.from(connectionMap.entries())) {
      if (data.points.length < 2) continue

      // For each pair of points in the connection, we need to route them
      // For simplicity, route the first point to the second point
      const start = this._projectToGraphBoundary(data.points[0])
      const end = this._projectToGraphBoundary(data.points[1])

      this.xyConnections.push({
        start,
        end,
        connectionId: connectionName,
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
   * Project a port point to the nearest position on the graph boundary
   */
  private _projectToGraphBoundary(pp: PortPoint): { x: number; y: number } {
    if (!this.graphBounds) {
      return { x: pp.x, y: pp.y }
    }

    const { minX, maxX, minY, maxY } = this.graphBounds

    // Find the closest edge
    const distLeft = Math.abs(pp.x - minX)
    const distRight = Math.abs(pp.x - maxX)
    const distTop = Math.abs(pp.y - maxY)
    const distBottom = Math.abs(pp.y - minY)

    const minDist = Math.min(distLeft, distRight, distTop, distBottom)

    // Clamp y to graph bounds
    const clampedY = Math.max(minY, Math.min(maxY, pp.y))
    // Clamp x to graph bounds
    const clampedX = Math.max(minX, Math.min(maxX, pp.x))

    if (minDist === distLeft) {
      return { x: minX, y: clampedY }
    } else if (minDist === distRight) {
      return { x: maxX, y: clampedY }
    } else if (minDist === distTop) {
      return { x: clampedX, y: maxY }
    } else {
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

      // Extract route points from the solved path
      const routePoints: Array<{ x: number; y: number; z: number }> = []
      const jumpers: Jumper[] = []

      for (const candidate of solvedRoute.path) {
        const port = candidate.port as any
        const point = { x: port.d.x, y: port.d.y, z: 0 }
        routePoints.push(point)

        // Check if we crossed through a jumper (lastRegion is a throughjumper)
        const region = candidate.lastRegion as any
        if (region?.d?.isThroughJumper && !usedThroughJumpers.has(region.regionId)) {
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
            footprint: "1206",
          })
        }
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
        this._drawJumperPads(
          graphics,
          jumper,
          safeTransparentize(color, 0.5),
        )
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
