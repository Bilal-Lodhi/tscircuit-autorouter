import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"
import { pointToSegmentDistance } from "@tscircuit/math-utils"

const CURSOR_STEP_DISTANCE = 0.25

interface Point2D {
  x: number
  y: number
}

interface Point3D extends Point2D {
  z: number
}

export interface TraceWidthSolverInput {
  hdRoutes: HighDensityRoute[]
  obstacles?: Obstacle[]
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>
  nominalTraceWidth?: number
  minTraceWidth: number
}

/**
 * TraceWidthSolver determines the optimal trace width for each route.
 * It walks along each trace with a cursor, checking clearance from obstacles
 * and non-connected traces. If clearance is sufficient for nominalTraceWidth,
 * it uses that; otherwise it falls back to minTraceWidth.
 *
 * nominalTraceWidth defaults to minTraceWidth * 2 if not specified.
 */
export class TraceWidthSolver extends BaseSolver {
  hdRoutes: HighDensityRoute[]
  hdRoutesWithWidths: HighDensityRoute[] = []

  nominalTraceWidth: number
  minTraceWidth: number

  unprocessedRoutes: HighDensityRoute[] = []
  processedRoutes: HighDensityRoute[] = []

  // Current trace being processed
  currentTrace: HighDensityRoute | null = null
  cursorPosition: Point3D | null = null
  currentTraceSegmentIndex = 0
  currentTraceSegmentT = 0 // Parameter t in [0, 1] along the current segment
  hasInsufficientClearance = false

  obstacleSHI?: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>

  constructor(private input: TraceWidthSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6

    this.hdRoutes = [...input.hdRoutes]
    this.minTraceWidth = input.minTraceWidth
    this.nominalTraceWidth =
      input.nominalTraceWidth ?? input.minTraceWidth * 2

    this.unprocessedRoutes = [...this.hdRoutes]
    this.connMap = input.connMap
    this.colorMap = input.colorMap

    if (input.obstacles && input.obstacles.length > 0) {
      this.obstacleSHI = new ObstacleSpatialHashIndex(
        "flatbush",
        input.obstacles,
      )
    }

    this.hdRouteSHI = new HighDensityRouteSpatialIndex(this.hdRoutes)
  }

  _step() {
    // If no current trace, dequeue one
    if (!this.currentTrace) {
      const nextTrace = this.unprocessedRoutes.shift()

      if (!nextTrace) {
        // All traces processed
        this.hdRoutesWithWidths = this.processedRoutes
        this.solved = true
        return
      }

      // Initialize the new trace processing
      this.currentTrace = nextTrace
      if (this.currentTrace.route.length < 2) {
        // Trace is too short to process, just pass it through with minTraceWidth
        this.processedRoutes.push({
          ...this.currentTrace,
          traceThickness: this.minTraceWidth,
        })
        this.currentTrace = null
        return
      }

      const startPoint = this.currentTrace.route[0]!
      this.cursorPosition = { ...startPoint }
      this.currentTraceSegmentIndex = 0
      this.currentTraceSegmentT = 0
      this.hasInsufficientClearance = false
      return
    }

    // Step the cursor forward along the trace
    const stepped = this.stepCursorForward()

    if (!stepped) {
      // Reached end of trace, finalize it
      this.finalizeCurrentTrace()
      return
    }

    // Check clearance at current cursor position
    const clearance = this.getClearanceAtPosition(this.cursorPosition!)

    // Check if there's enough clearance for nominal width
    // We need clearance of at least (nominalTraceWidth - minTraceWidth) / 2 extra
    // beyond what minTraceWidth would need
    const requiredClearance = this.nominalTraceWidth / 2
    if (clearance < requiredClearance) {
      this.hasInsufficientClearance = true
    }
  }

  /**
   * Steps the cursor forward by CURSOR_STEP_DISTANCE along the trace
   * Returns false if we've reached the end of the trace
   */
  private stepCursorForward(): boolean {
    if (!this.currentTrace || !this.cursorPosition) return false

    const route = this.currentTrace.route
    let remainingDistance = CURSOR_STEP_DISTANCE

    while (remainingDistance > 0) {
      if (this.currentTraceSegmentIndex >= route.length - 1) {
        // Reached end of trace
        return false
      }

      const segStart = route[this.currentTraceSegmentIndex]!
      const segEnd = route[this.currentTraceSegmentIndex + 1]!

      const segDx = segEnd.x - segStart.x
      const segDy = segEnd.y - segStart.y
      const segLength = Math.sqrt(segDx * segDx + segDy * segDy)

      if (segLength === 0) {
        // Zero-length segment, skip it
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0
        continue
      }

      // How far we are into this segment
      const currentDistInSeg = this.currentTraceSegmentT * segLength
      const distToSegEnd = segLength - currentDistInSeg

      if (remainingDistance <= distToSegEnd) {
        // We can complete the step within this segment
        const newDistInSeg = currentDistInSeg + remainingDistance
        this.currentTraceSegmentT = newDistInSeg / segLength

        // Update cursor position
        this.cursorPosition = {
          x: segStart.x + segDx * this.currentTraceSegmentT,
          y: segStart.y + segDy * this.currentTraceSegmentT,
          z: segStart.z, // Stay on same layer within segment
        }

        return true
      } else {
        // Step goes beyond this segment
        remainingDistance -= distToSegEnd
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0

        if (this.currentTraceSegmentIndex >= route.length - 1) {
          // Reached end of trace
          const lastPoint = route[route.length - 1]!
          this.cursorPosition = { ...lastPoint }
          return false
        }
      }
    }

    return true
  }

  /**
   * Gets the minimum clearance at a given position from obstacles and other traces
   */
  private getClearanceAtPosition(position: Point3D): number {
    if (!this.currentTrace) return Infinity

    const rootConnectionName =
      this.currentTrace.rootConnectionName ?? this.currentTrace.connectionName
    const searchRadius = this.nominalTraceWidth * 2
    let minClearance = Infinity

    // Check for obstacles within the search radius
    if (this.obstacleSHI) {
      const nearbyObstacles = this.obstacleSHI.searchArea(
        position.x,
        position.y,
        searchRadius,
        searchRadius,
      )

      for (const obstacle of nearbyObstacles) {
        // Check if obstacle is on the same layer
        if (obstacle.zLayers && !obstacle.zLayers.includes(position.z)) {
          continue
        }

        // Check if obstacle is connected to this trace's net
        if (obstacle.connectedTo.includes(rootConnectionName)) {
          continue
        }

        // Check if obstacle's own ID is connected
        if (
          obstacle.obstacleId &&
          this.connMap?.areIdsConnected(rootConnectionName, obstacle.obstacleId)
        ) {
          continue
        }

        // Check connectivity via connMap
        let isConnected = false
        if (this.connMap) {
          for (const connectedId of obstacle.connectedTo) {
            if (this.connMap.areIdsConnected(rootConnectionName, connectedId)) {
              isConnected = true
              break
            }
          }
        }
        if (isConnected) continue

        // Calculate distance to obstacle edges
        const obstacleMinX = obstacle.center.x - obstacle.width / 2
        const obstacleMaxX = obstacle.center.x + obstacle.width / 2
        const obstacleMinY = obstacle.center.y - obstacle.height / 2
        const obstacleMaxY = obstacle.center.y + obstacle.height / 2

        // Calculate distance from point to obstacle rectangle
        const dx = Math.max(
          obstacleMinX - position.x,
          0,
          position.x - obstacleMaxX,
        )
        const dy = Math.max(
          obstacleMinY - position.y,
          0,
          position.y - obstacleMaxY,
        )
        const distToObstacle = Math.sqrt(dx * dx + dy * dy)

        if (distToObstacle < minClearance) {
          minClearance = distToObstacle
        }
      }
    }

    // Check for non-connected traces within the search radius
    const nearbyRoutes = this.hdRouteSHI.getConflictingRoutesNearPoint(
      { x: position.x, y: position.y },
      searchRadius,
    )

    for (const { conflictingRoute, distance } of nearbyRoutes) {
      const routeRootName =
        conflictingRoute.rootConnectionName ?? conflictingRoute.connectionName

      // Don't check our own trace
      if (routeRootName === rootConnectionName) {
        continue
      }

      // Check connectivity
      if (this.connMap?.areIdsConnected(rootConnectionName, routeRootName)) {
        continue
      }

      // Calculate clearance (distance minus half the other trace's width)
      const otherTraceHalfWidth = (conflictingRoute.traceThickness ?? 0.15) / 2
      const clearance = distance - otherTraceHalfWidth

      if (clearance < minClearance) {
        minClearance = clearance
      }
    }

    return minClearance
  }

  /**
   * Finalizes the current trace with the determined width
   */
  private finalizeCurrentTrace() {
    if (!this.currentTrace) return

    // Determine the trace width based on whether we found any insufficient clearance
    const traceWidth = this.hasInsufficientClearance
      ? this.minTraceWidth
      : this.nominalTraceWidth

    // Create the route with the determined width
    const routeWithWidth: HighDensityRoute = {
      connectionName: this.currentTrace.connectionName,
      rootConnectionName: this.currentTrace.rootConnectionName,
      traceThickness: traceWidth,
      viaDiameter: this.currentTrace.viaDiameter,
      route: [...this.currentTrace.route],
      vias: [...this.currentTrace.vias],
    }

    this.processedRoutes.push(routeWithWidth)
    this.currentTrace = null
    this.cursorPosition = null
    this.hasInsufficientClearance = false
  }

  visualize(): GraphicsObject {
    const visualization: GraphicsObject & {
      lines: NonNullable<GraphicsObject["lines"]>
      points: NonNullable<GraphicsObject["points"]>
      circles: NonNullable<GraphicsObject["circles"]>
    } = {
      lines: [],
      points: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: `Trace Width Solver (nominal: ${this.nominalTraceWidth.toFixed(2)}mm, min: ${this.minTraceWidth.toFixed(2)}mm)`,
    }

    // Draw processed routes with their determined widths
    for (const route of this.processedRoutes) {
      if (route.route.length === 0) continue

      const color = this.colorMap?.[route.connectionName] || "#888888"
      const isNominalWidth = route.traceThickness === this.nominalTraceWidth

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: isNominalWidth ? "green" : "orange",
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (w=${route.traceThickness.toFixed(2)})`,
          })
        }
      }

      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(255, 0, 255, 0.5)",
          label: `${route.connectionName} via`,
        })
      }
    }

    // Draw current trace being processed (if any)
    if (this.currentTrace) {
      for (let i = 0; i < this.currentTrace.route.length - 1; i++) {
        const current = this.currentTrace.route[i]!
        const next = this.currentTrace.route[i + 1]!

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: "gray",
            strokeWidth: this.currentTrace.traceThickness ?? this.minTraceWidth,
          })
        }
      }

      // Draw cursor position
      if (this.cursorPosition) {
        visualization.circles.push({
          center: { x: this.cursorPosition.x, y: this.cursorPosition.y },
          radius: this.nominalTraceWidth / 2,
          stroke: this.hasInsufficientClearance ? "red" : "green",
          fill: "none",
          label: this.hasInsufficientClearance
            ? "Insufficient clearance"
            : "Sufficient clearance",
        })

        visualization.points.push({
          x: this.cursorPosition.x,
          y: this.cursorPosition.y,
          color: "orange",
          label: "Cursor",
        })
      }
    }

    // Draw unprocessed routes
    for (const route of this.unprocessedRoutes) {
      if (route.route.length === 0) continue

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: "rgba(128, 128, 128, 0.3)",
            strokeWidth: route.traceThickness ?? this.minTraceWidth,
          })
        }
      }
    }

    return visualization
  }

  /** Returns the routes with determined widths. This is the primary output of the solver. */
  getHdRoutesWithWidths(): HighDensityRoute[] {
    return this.hdRoutesWithWidths
  }
}
