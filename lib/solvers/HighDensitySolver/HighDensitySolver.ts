import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { IntraNodeRouteSolver } from "./IntraNodeSolver"
import { HyperSingleIntraNodeSolver } from "../HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { isHighDensityNodeSolvable } from "lib/utils/isHighDensityNodeSolvable"

export class HighDensitySolver extends BaseSolver {
  unsolvedNodePortPoints: NodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>

  // Defaults as specified: viaDiameter of 0.6 and traceThickness of 0.15
  readonly defaultViaDiameter = 0.6
  readonly defaultTraceThickness = 0.15
  viaDiameter: number
  traceWidth: number

  failedSolvers: (IntraNodeRouteSolver | HyperSingleIntraNodeSolver)[]
  activeSubSolver: IntraNodeRouteSolver | HyperSingleIntraNodeSolver | null =
    null
  connMap?: ConnectivityMap

  constructor({
    nodePortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
  }) {
    super()
    this.unsolvedNodePortPoints = nodePortPoints
    this.colorMap = colorMap ?? {}
    this.connMap = connMap
    this.routes = []
    this.failedSolvers = []
    this.MAX_ITERATIONS = 1e6
    this.viaDiameter = viaDiameter ?? this.defaultViaDiameter
    this.traceWidth = traceWidth ?? this.defaultTraceThickness
  }

  /**
   * Each iteration, pop an unsolved node and attempt to find the routes inside
   * of it.
   */
  _step() {
    this.updateCacheStats()
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.routes.push(...this.activeSubSolver.solvedRoutes)
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.failedSolvers.push(this.activeSubSolver)
        this.activeSubSolver = null
      }
      this.updateCacheStats()
      return
    }
    if (this.unsolvedNodePortPoints.length === 0) {
      if (this.failedSolvers.length > 0) {
        this.solved = false
        this.failed = true
        // debugger
        this.error = `Failed to solve ${this.failedSolvers.length} nodes, ${this.failedSolvers.slice(0, 5).map((fs) => fs.nodeWithPortPoints.capacityMeshNodeId)}. err0: ${this.failedSolvers[0].error}.`
        this.updateCacheStats()
        return
      }

      this.solved = true
      this.updateCacheStats()
      return
    }
    const node = this.unsolvedNodePortPoints.pop()!

    // Check if node is obviously impossible before attempting to solve
    const diagnostics = isHighDensityNodeSolvable({
      node,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
    })
    // @ts-ignore TURN ON WHEN e.g. e2e3 passes
    if (false && !diagnostics.isSolvable) {
      // Build descriptive error message based on what failed
      // NOTE: Error message format is consumed by upstream error reporting.
      // Maintain stability: "Impossible Node: <reason>" pattern
      let errorMsg = "Impossible Node"
      if (diagnostics.numOverlaps > 0) {
        const tolerance = this.traceWidth
          ? (1.5 * this.traceWidth).toFixed(2)
          : (diagnostics.viaDiameter / 2 + diagnostics.obstacleMargin).toFixed(
              2,
            )
        errorMsg += `: ${diagnostics.numOverlaps} port overlap(s) detected (ports closer than ${tolerance}mm on same layer)`
      } else if (
        diagnostics.nodeWidth < diagnostics.requiredSpan &&
        diagnostics.nodeHeight < diagnostics.requiredSpan
      ) {
        errorMsg += `: node dimensions ${diagnostics.nodeWidth.toFixed(2)}mm x ${diagnostics.nodeHeight.toFixed(2)}mm cannot fit required span ${diagnostics.requiredSpan.toFixed(2)}mm for ${diagnostics.effectiveViasUsed} vias (${diagnostics.totalCrossings} crossings + ${diagnostics.numLayerChangeConnections} layer changes)`
      }

      // Create a mock failed solver to maintain consistency with existing error reporting flow.
      // This allows upstream consumers (e.g. visualization, error aggregation) to treat
      // pre-validated impossible nodes the same as nodes that failed during solving.
      const mockFailedSolver = {
        nodeWithPortPoints: node,
        failed: true,
        solved: false,
        error: errorMsg,
      } as any

      this.failedSolvers.push(mockFailedSolver)
      this.updateCacheStats()
      return
    }

    this.activeSubSolver = new HyperSingleIntraNodeSolver({
      nodeWithPortPoints: node,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
    })
    this.updateCacheStats()
  }

  private updateCacheStats() {
    const cacheProvider = getGlobalInMemoryCache()
    this.stats.intraNodeCacheHits = cacheProvider.cacheHits
    this.stats.intraNodeCacheMisses = cacheProvider.cacheMisses
  }

  visualize(): GraphicsObject {
    let graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
    for (const route of this.routes) {
      // Merge segments based on z-coordinate
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

      // Add merged segments to graphics
      for (const segment of mergedSegments) {
        graphics.lines!.push({
          points: segment.points,
          label: segment.connectionName,
          strokeColor:
            segment.z === 0
              ? segment.color
              : safeTransparentize(segment.color, 0.75),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? "10, 5" : undefined,
        })
      }
      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          layer: "z0,1",
          radius: route.viaDiameter / 2,
          fill: this.colorMap[route.connectionName],
          label: `${route.connectionName} via`,
        })
      }
    }
    for (const solver of this.failedSolvers) {
      const node = solver.nodeWithPortPoints

      // Add a small rectangle in the center for failed nodes
      const rectWidth = node.width * 0.1
      const rectHeight = node.height * 0.1
      graphics.rects!.push({
        center: {
          x: node.center.x - rectWidth / 2,
          y: node.center.y - rectHeight / 2,
        },
        layer: "did_not_connect",
        width: rectWidth,
        height: rectHeight,
        fill: "red",
        label: `Failed: ${node.capacityMeshNodeId}`,
      })

      // Group port points by connectionName
      const connectionGroups: Record<
        string,
        { x: number; y: number; z: number }[]
      > = {}
      for (const pt of node.portPoints) {
        if (!connectionGroups[pt.connectionName]) {
          connectionGroups[pt.connectionName] = []
        }
        connectionGroups[pt.connectionName].push({ x: pt.x, y: pt.y, z: pt.z })
      }

      for (const [connectionName, points] of Object.entries(connectionGroups)) {
        for (let i = 0; i < points.length - 1; i++) {
          const start = points[i]
          const end = points[i + 1]
          graphics.lines!.push({
            points: [start, end],
            strokeColor: "red",
            strokeDash: "10, 5",
            layer: "did_not_connect",
          })
        }
      }
    }
    if (this.activeSubSolver) {
      graphics = combineVisualizations(
        graphics,
        this.activeSubSolver.visualize(),
      )
    }
    return graphics
  }
}
