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

export type HyperGraphPatternType =
  | "single_1206x4"
  | "1x2_1206x4"
  | "2x2_1206x4"

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
  constructorParams: JumperPrepatternSolver2Params
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
    this.constructorParams = params
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

  getConstructorParams(): JumperPrepatternSolver2Params {
    return this.constructorParams
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
    if (patternType === "1x2_1206x4") {
      return { cols: 1, rows: 2 }
    }
    return { cols: 1, rows: 1 }
  }

  private _initializeGraph(): boolean {
    const node = this.nodeWithPortPoints
    const patternConfig = this._getPatternConfig()
    const orientation = this.hyperParameters.ORIENTATION ?? "vertical"

    // Calculate node bounds
    const nodeBounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    this.graphBounds = nodeBounds

    // Generate the base jumper grid to fit the node bounds exactly
    const baseGraph = generateJumperX4Grid({
      cols: patternConfig.cols,
      rows: patternConfig.rows,
      marginX: 1.2,
      marginY: 1.2,
      outerPaddingX: 0.4,
      outerPaddingY: 0.4,
      innerColChannelPointCount: 3,
      innerRowChannelPointCount: 3,
      outerChannelXPointCount: 5,
      outerChannelYPointCount: 5,
      regionsBetweenPads: true,
      orientation,
      bounds: nodeBounds,
    })

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

    // Create XY connections - use port point positions directly since graph matches node bounds
    this.xyConnections = []
    for (const [connectionName, data] of Array.from(connectionMap.entries())) {
      if (data.points.length < 2) continue

      this.xyConnections.push({
        start: { x: data.points[0].x, y: data.points[0].y },
        end: { x: data.points[1].x, y: data.points[1].y },
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
