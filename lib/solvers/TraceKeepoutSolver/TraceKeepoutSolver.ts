import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"

const CURSOR_STEP_DISTANCE = 0.05

interface Point2D {
  x: number
  y: number
}

interface Point3D extends Point2D {
  z: number
}

export interface TraceKeepoutSolverInput {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  keepoutRadiusSchedule?: number[]
}

/**
 * TraceKeepoutSolver adjusts traces to maintain keepout distance from obstacles
 * and non-connected traces. It works by walking along each trace with a cursor,
 * detecting obstacles within a keepout radius, and pushing the draw position
 * orthogonally to avoid them.
 *
 * The solver processes traces through multiple passes with decreasing keepout
 * radii as defined by KEEPOUT_RADIUS_SCHEDULE.
 */
export class TraceKeepoutSolver extends BaseSolver {
  hdRoutes: HighDensityRoute[]
  redrawnHdRoutes: HighDensityRoute[] = []

  KEEPOUT_RADIUS_SCHEDULE: number[]
  currentScheduleIndex = 0
  currentKeepoutRadius: number

  unprocessedRoutes: HighDensityRoute[] = []
  processedRoutes: HighDensityRoute[] = []

  // Current trace being processed
  currentTrace: HighDensityRoute | null = null
  cursorPosition: Point3D | null = null
  drawPosition: Point2D | null = null
  currentTraceSegmentIndex = 0
  currentTraceSegmentT = 0 // Parameter t in [0, 1] along the current segment
  recordedDrawPositions: Point3D[] = []

  obstacleSHI: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex

  constructor(private input: TraceKeepoutSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.hdRoutes = [...input.hdRoutes]
    this.KEEPOUT_RADIUS_SCHEDULE = input.keepoutRadiusSchedule ?? [
      0.5, 0.3, 0.15,
    ]
    this.currentKeepoutRadius = this.KEEPOUT_RADIUS_SCHEDULE[0] ?? 0.15
    this.unprocessedRoutes = [...input.hdRoutes]

    this.obstacleSHI = new ObstacleSpatialHashIndex("flatbush", input.obstacles)
    this.hdRouteSHI = new HighDensityRouteSpatialIndex(input.hdRoutes)

    // Make sure the start/endpoint of any route is properly connected in the
    // connMap to the obstacle
    for (const [
      endpoint,
      connectionName,
      rootConnectionName,
    ] of this.hdRoutes.flatMap(
      (
        r,
      ): [
        { x: number; y: number; z: number },
        string,
        string | undefined,
      ][] => [
        [r.route[0]!, r.connectionName, r.rootConnectionName],
        [r.route[r.route.length - 1]!, r.connectionName, r.rootConnectionName],
      ],
    )) {
      const obstacles = this.obstacleSHI
        .searchArea(endpoint.x, endpoint.y, 0.01, 0.01)
        .filter((o) => o.zLayers?.includes(endpoint.z))
      if (obstacles.length === 0) continue
      const obstacle = obstacles[0]!

      this.input.connMap.addConnections([
        [
          connectionName,
          rootConnectionName!,
          ...(obstacle.offBoardConnectsTo ?? []),
          obstacle.obstacleId!,
          ...obstacle.connectedTo,
        ].filter(Boolean),
      ])
    }
  }

  _step() {
    // If no current trace, dequeue one
    if (!this.currentTrace) {
      const nextTrace = this.unprocessedRoutes.shift()

      if (!nextTrace) {
        // All traces processed for this schedule pass
        // Check if there's another keepout radius in the schedule
        this.currentScheduleIndex++
        if (this.currentScheduleIndex < this.KEEPOUT_RADIUS_SCHEDULE.length) {
          // Requeue all traces with the new keepout radius
          this.currentKeepoutRadius =
            this.KEEPOUT_RADIUS_SCHEDULE[this.currentScheduleIndex]!
          this.unprocessedRoutes = [...this.processedRoutes]
          this.processedRoutes = []
          // Rebuild the spatial index with processed routes
          this.hdRouteSHI = new HighDensityRouteSpatialIndex(
            this.unprocessedRoutes,
          )
          return
        }

        // All schedule passes complete
        this.redrawnHdRoutes = this.processedRoutes
        this.solved = true
        return
      }

      // Initialize the new trace processing
      this.currentTrace = nextTrace
      if (this.currentTrace.route.length < 2) {
        // Trace is too short to process, just pass it through
        this.processedRoutes.push(this.currentTrace)
        this.currentTrace = null
        return
      }

      const startPoint = this.currentTrace.route[0]!
      this.cursorPosition = { ...startPoint }
      this.drawPosition = { x: startPoint.x, y: startPoint.y }
      this.currentTraceSegmentIndex = 0
      this.currentTraceSegmentT = 0
      this.recordedDrawPositions = [{ ...startPoint }]
      return
    }

    // Step the cursor forward along the trace
    const stepped = this.stepCursorForward()

    if (!stepped) {
      // Reached end of trace, finalize it
      this.finalizeCurrentTrace()
      return
    }

    // Check for non-connected obstacles and traces within the keepout radius
    const obstacleAvoidance = this.checkForObstacles()

    if (obstacleAvoidance) {
      // Move draw position to avoid obstacles
      this.drawPosition = obstacleAvoidance
    } else {
      // No obstacles, draw position follows cursor
      this.drawPosition = {
        x: this.cursorPosition!.x,
        y: this.cursorPosition!.y,
      }
    }

    // Record the draw position
    this.recordedDrawPositions.push({
      x: this.drawPosition.x,
      y: this.drawPosition.y,
      z: this.cursorPosition!.z,
    })
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
   * Checks for non-connected obstacles and traces within the keepout radius
   * Returns a new draw position that avoids obstacles, or null if no avoidance needed
   */
  private checkForObstacles(): Point2D | null {
    if (!this.currentTrace || !this.cursorPosition) return null

    const rootConnectionName =
      this.currentTrace.rootConnectionName ?? this.currentTrace.connectionName
    const searchRadius = this.currentKeepoutRadius

    // Check for obstacles within the keepout radius
    const nearbyObstacles = this.obstacleSHI.searchArea(
      this.cursorPosition.x,
      this.cursorPosition.y,
      searchRadius * 2,
      searchRadius * 2,
    )

    // Filter to non-connected obstacles on the same layer
    const nonConnectedObstacles = nearbyObstacles.filter((obstacle) => {
      // Check if obstacle is on the same layer
      if (
        obstacle.zLayers &&
        !obstacle.zLayers.includes(this.cursorPosition!.z)
      ) {
        return false
      }

      // Check if obstacle is connected to this trace's net
      if (obstacle.connectedTo.includes(rootConnectionName)) {
        return false
      }

      // Check if obstacle's own ID is connected
      if (
        obstacle.obstacleId &&
        this.input.connMap.areIdsConnected(rootConnectionName, obstacle.obstacleId)
      ) {
        return false
      }

      // Check connectivity via connMap
      for (const connectedId of obstacle.connectedTo) {
        if (
          this.input.connMap.areIdsConnected(rootConnectionName, connectedId)
        ) {
          return false
        }
      }

      return true
    })

    // Check for non-connected traces within the keepout radius
    const nearbyRoutes = this.hdRouteSHI.getConflictingRoutesNearPoint(
      { x: this.cursorPosition.x, y: this.cursorPosition.y },
      searchRadius,
    )

    const nonConnectedRoutes = nearbyRoutes.filter(({ conflictingRoute }) => {
      const routeRootName =
        conflictingRoute.rootConnectionName ?? conflictingRoute.connectionName

      // Don't avoid our own trace
      if (routeRootName === rootConnectionName) {
        return false
      }

      // Check connectivity
      if (
        this.input.connMap.areIdsConnected(rootConnectionName, routeRootName)
      ) {
        return false
      }

      return true
    })

    // If there's nothing to avoid, return null
    if (nonConnectedObstacles.length === 0 && nonConnectedRoutes.length === 0) {
      return null
    }

    // Calculate avoidance direction - push orthogonally to the trace direction
    const avoidanceVector = this.calculateAvoidanceVector(
      nonConnectedObstacles,
      nonConnectedRoutes,
    )

    if (!avoidanceVector) {
      // Couldn't calculate avoidance, fall back to cursor position
      return { x: this.cursorPosition.x, y: this.cursorPosition.y }
    }

    // Calculate new draw position
    const newDrawPos = {
      x: this.cursorPosition.x + avoidanceVector.x,
      y: this.cursorPosition.y + avoidanceVector.y,
    }

    // Verify the new position doesn't hit ANY non-connected obstacle
    // Search a larger area around the new position to catch all potential collisions
    if (
      this.positionHitsAnyNonConnectedObstacle(newDrawPos, rootConnectionName)
    ) {
      return { x: this.cursorPosition.x, y: this.cursorPosition.y }
    }

    return newDrawPos
  }

  /**
   * Checks if a position would be within keepoutRadius of any non-connected obstacle
   */
  private positionHitsAnyNonConnectedObstacle(
    pos: Point2D,
    rootConnectionName: string,
  ): boolean {
    if (!this.cursorPosition) return false

    const keepout = this.currentKeepoutRadius

    // Search for obstacles near the new position (expanded by keepout radius)
    const nearbyObstacles = this.obstacleSHI.searchArea(
      pos.x,
      pos.y,
      keepout * 4,
      keepout * 4,
    )

    for (const obstacle of nearbyObstacles) {
      // Check if obstacle is on the same layer
      if (
        obstacle.zLayers &&
        !obstacle.zLayers.includes(this.cursorPosition.z)
      ) {
        continue
      }

      // Check if obstacle is connected to this trace's net
      if (obstacle.connectedTo.includes(rootConnectionName)) {
        continue
      }

      // Check if obstacle's own ID is connected
      if (
        obstacle.obstacleId &&
        this.input.connMap.areIdsConnected(rootConnectionName, obstacle.obstacleId)
      ) {
        continue
      }

      // Check connectivity via connMap
      let isConnected = false
      for (const connectedId of obstacle.connectedTo) {
        if (
          this.input.connMap.areIdsConnected(rootConnectionName, connectedId)
        ) {
          isConnected = true
          break
        }
      }
      if (isConnected) continue

      // Check if position is within keepoutRadius of this obstacle
      // Expand the obstacle bounds by keepoutRadius
      const halfW = obstacle.width / 2 + keepout
      const halfH = obstacle.height / 2 + keepout
      if (
        pos.x >= obstacle.center.x - halfW &&
        pos.x <= obstacle.center.x + halfW &&
        pos.y >= obstacle.center.y - halfH &&
        pos.y <= obstacle.center.y + halfH
      ) {
        return true
      }
    }

    return false
  }

  /**
   * Calculates the avoidance vector to push the draw position away from obstacles
   * Moves the minimum amount needed to get obstacles outside the keepout radius
   */
  private calculateAvoidanceVector(
    obstacles: Obstacle[],
    routes: Array<{ conflictingRoute: HighDensityRoute; distance: number }>,
  ): Point2D | null {
    if (!this.currentTrace || !this.cursorPosition) return null

    // Get the trace direction at current position
    const traceDir = this.getTraceDirectionAtCursor()
    if (!traceDir) return null

    // Calculate orthogonal direction (perpendicular to trace)
    const orthogonal1 = { x: -traceDir.y, y: traceDir.x }
    const orthogonal2 = { x: traceDir.y, y: -traceDir.x }

    // Find the closest obstacle/trace point and determine push direction
    const closest = this.findClosestObstaclePoint(obstacles, routes)
    if (!closest) return null

    // Vector from cursor to closest obstacle point
    const toObstacle = {
      x: closest.x - this.cursorPosition.x,
      y: closest.y - this.cursorPosition.y,
    }
    const distToObstacle = Math.sqrt(toObstacle.x ** 2 + toObstacle.y ** 2)

    // If already outside keepout radius, no movement needed
    if (distToObstacle >= this.currentKeepoutRadius) {
      return null
    }

    // Choose which orthogonal direction points away from the obstacle
    const dot1 = orthogonal1.x * toObstacle.x + orthogonal1.y * toObstacle.y
    const dot2 = orthogonal2.x * toObstacle.x + orthogonal2.y * toObstacle.y
    const pushDir = dot1 < dot2 ? orthogonal1 : orthogonal2

    // Calculate the perpendicular component of toObstacle relative to pushDir
    // d_perp = toObstacle · pushDir (how far obstacle is in the push direction)
    const d_perp = toObstacle.x * pushDir.x + toObstacle.y * pushDir.y

    // d_along = component along trace direction
    const d_along = toObstacle.x * traceDir.x + toObstacle.y * traceDir.y

    // Calculate minimum push distance needed
    // After pushing by m, new distance² = d_along² + (d_perp - m)²
    // We want new distance = keepoutRadius
    // keepoutRadius² = d_along² + (d_perp - m)²
    // (d_perp - m)² = keepoutRadius² - d_along²

    const keepoutSq = this.currentKeepoutRadius ** 2
    const alongSq = d_along ** 2

    if (keepoutSq <= alongSq) {
      // Obstacle is far enough along trace direction, no orthogonal push needed
      return null
    }

    const requiredPerpDist = Math.sqrt(keepoutSq - alongSq)

    // We need |d_perp - m| >= requiredPerpDist
    // Since pushDir points away (d_perp should be negative or we push to make it more negative)
    // m = d_perp - (-requiredPerpDist) = d_perp + requiredPerpDist (if d_perp < 0)
    // m = d_perp - requiredPerpDist (if d_perp > 0, but we chose pushDir to point away so this shouldn't happen)

    let pushDistance: number
    if (d_perp <= 0) {
      // Obstacle is in opposite direction of push, push by enough to clear
      pushDistance = Math.abs(d_perp) + requiredPerpDist
    } else {
      // Obstacle is in same direction as push (shouldn't happen with correct pushDir choice)
      // Push enough to get past it
      pushDistance = requiredPerpDist - d_perp
      if (pushDistance < 0) pushDistance = 0
    }

    // Add small margin
    pushDistance += 0.01

    return {
      x: pushDir.x * pushDistance,
      y: pushDir.y * pushDistance,
    }
  }

  /**
   * Finds the closest obstacle or trace point to the cursor
   */
  private findClosestObstaclePoint(
    obstacles: Obstacle[],
    routes: Array<{ conflictingRoute: HighDensityRoute; distance: number }>,
  ): Point2D | null {
    if (!this.cursorPosition) return null

    let closestX = 0
    let closestY = 0
    let closestDistSq = Infinity
    let hasClosest = false

    // Check obstacle centers (could improve by checking closest point on obstacle edge)
    for (const obs of obstacles) {
      // Find closest point on obstacle rectangle to cursor
      const clampedX = Math.max(
        obs.center.x - obs.width / 2,
        Math.min(obs.center.x + obs.width / 2, this.cursorPosition.x),
      )
      const clampedY = Math.max(
        obs.center.y - obs.height / 2,
        Math.min(obs.center.y + obs.height / 2, this.cursorPosition.y),
      )
      const distSq =
        (clampedX - this.cursorPosition.x) ** 2 +
        (clampedY - this.cursorPosition.y) ** 2
      if (distSq < closestDistSq) {
        closestDistSq = distSq
        closestX = clampedX
        closestY = clampedY
        hasClosest = true
      }
    }

    // Check closest point on each conflicting route segment
    for (const { conflictingRoute } of routes) {
      const routePts = conflictingRoute.route
      for (let i = 0; i < routePts.length - 1; i++) {
        const a = routePts[i]!
        const b = routePts[i + 1]!
        const closest = this.closestPointOnSegment(this.cursorPosition, a, b)
        const distSq =
          (closest.x - this.cursorPosition.x) ** 2 +
          (closest.y - this.cursorPosition.y) ** 2
        if (distSq < closestDistSq) {
          closestDistSq = distSq
          closestX = closest.x
          closestY = closest.y
          hasClosest = true
        }
      }
    }

    if (!hasClosest) return null

    return { x: closestX, y: closestY }
  }

  /**
   * Gets the normalized direction vector of the trace at the cursor position
   */
  private getTraceDirectionAtCursor(): Point2D | null {
    if (!this.currentTrace) return null

    const route = this.currentTrace.route
    if (this.currentTraceSegmentIndex >= route.length - 1) {
      // At end of trace, use last segment direction
      const idx = Math.max(0, route.length - 2)
      const segStart = route[idx]!
      const segEnd = route[idx + 1]!
      const dx = segEnd.x - segStart.x
      const dy = segEnd.y - segStart.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len === 0) return { x: 1, y: 0 }
      return { x: dx / len, y: dy / len }
    }

    const segStart = route[this.currentTraceSegmentIndex]!
    const segEnd = route[this.currentTraceSegmentIndex + 1]!
    const dx = segEnd.x - segStart.x
    const dy = segEnd.y - segStart.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) return { x: 1, y: 0 }
    return { x: dx / len, y: dy / len }
  }

  /**
   * Finds the closest point on a line segment to a given point
   */
  private closestPointOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy

    if (lenSq === 0) return { x: a.x, y: a.y }

    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))

    return {
      x: a.x + t * dx,
      y: a.y + t * dy,
    }
  }

  /**
   * Finalizes the current trace with the recorded draw positions
   */
  private finalizeCurrentTrace() {
    if (!this.currentTrace) return

    // Add the final point if not already there
    const lastRoutePoint =
      this.currentTrace.route[this.currentTrace.route.length - 1]!
    const lastRecorded =
      this.recordedDrawPositions[this.recordedDrawPositions.length - 1]
    if (
      !lastRecorded ||
      lastRecorded.x !== lastRoutePoint.x ||
      lastRecorded.y !== lastRoutePoint.y
    ) {
      this.recordedDrawPositions.push({ ...lastRoutePoint })
    }

    // Simplify the recorded positions to remove redundant points
    const simplifiedRoute = this.simplifyRoute(this.recordedDrawPositions)

    // Create the redrawn trace
    const redrawnTrace: HighDensityRoute = {
      connectionName: this.currentTrace.connectionName,
      rootConnectionName: this.currentTrace.rootConnectionName,
      traceThickness: this.currentTrace.traceThickness,
      viaDiameter: this.currentTrace.viaDiameter,
      route: simplifiedRoute,
      vias: [...this.currentTrace.vias], // Keep vias unchanged
    }

    this.processedRoutes.push(redrawnTrace)
    this.currentTrace = null
    this.cursorPosition = null
    this.drawPosition = null
    this.recordedDrawPositions = []
  }

  /**
   * Simplifies the route by removing collinear points
   */
  private simplifyRoute(points: Point3D[]): Point3D[] {
    if (points.length <= 2) return points

    const result: Point3D[] = [points[0]!]

    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1]!
      const curr = points[i]!
      const next = points[i + 1]!

      // Skip points where z changes - always keep layer transitions
      if (curr.z !== prev.z || curr.z !== next.z) {
        result.push(curr)
        continue
      }

      // Check if the point is collinear with prev and next
      const dx1 = curr.x - prev.x
      const dy1 = curr.y - prev.y
      const dx2 = next.x - curr.x
      const dy2 = next.y - curr.y

      // Cross product to check collinearity
      const cross = dx1 * dy2 - dy1 * dx2
      const epsilon = 1e-6

      if (Math.abs(cross) > epsilon) {
        // Not collinear, keep this point
        result.push(curr)
      }
    }

    result.push(points[points.length - 1]!)
    return result
  }

  visualize(): GraphicsObject {
    const visualization: GraphicsObject & {
      lines: NonNullable<GraphicsObject["lines"]>
      points: NonNullable<GraphicsObject["points"]>
      rects: NonNullable<GraphicsObject["rects"]>
      circles: NonNullable<GraphicsObject["circles"]>
    } = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: `Trace Keepout Solver (radius: ${this.currentKeepoutRadius.toFixed(2)})`,
    }

    // Visualize obstacles
    for (const obstacle of this.input.obstacles) {
      let fillColor = "rgba(128, 128, 128, 0.2)"
      const isOnLayer0 = obstacle.zLayers?.includes(0)
      const isOnLayer1 = obstacle.zLayers?.includes(1)

      if (isOnLayer0 && isOnLayer1) {
        fillColor = "rgba(128, 0, 128, 0.2)"
      } else if (isOnLayer0) {
        fillColor = "rgba(255, 0, 0, 0.2)"
      } else if (isOnLayer1) {
        fillColor = "rgba(0, 0, 255, 0.2)"
      }

      visualization.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: fillColor,
        label: `Obstacle (Z: ${obstacle.zLayers?.join(", ")})`,
      })
    }

    // Draw unprocessed routes in gray
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
            strokeColor: "rgba(128, 128, 128, 0.5)",
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (unprocessed)`,
          })
        }
      }

      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(128, 128, 128, 0.3)",
          label: `${route.connectionName} via (unprocessed)`,
        })
      }
    }

    // Draw processed routes
    for (const route of this.processedRoutes) {
      if (route.route.length === 0) continue

      const color = this.input.colorMap[route.connectionName] || "#888888"

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: current.z === 0 ? "red" : "blue",
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (z=${current.z})`,
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
    if (this.currentTrace && this.recordedDrawPositions.length > 0) {
      const color =
        this.input.colorMap[this.currentTrace.connectionName] || "#00FF00"

      for (let i = 0; i < this.recordedDrawPositions.length - 1; i++) {
        const current = this.recordedDrawPositions[i]!
        const next = this.recordedDrawPositions[i + 1]!

        visualization.lines.push({
          points: [
            { x: current.x, y: current.y },
            { x: next.x, y: next.y },
          ],
          strokeColor: "green",
          strokeWidth: this.currentTrace.traceThickness,
        })
      }

      // Draw cursor position
      if (this.cursorPosition) {
        visualization.circles.push({
          center: { x: this.cursorPosition.x, y: this.cursorPosition.y },
          radius: this.currentKeepoutRadius,
          stroke: "orange",
          label: "Cursor keepout",
        })

        visualization.points.push({
          x: this.cursorPosition.x,
          y: this.cursorPosition.y,
          color: "orange",
          label: "Cursor",
        })
      }

      // Draw draw position
      if (this.drawPosition) {
        visualization.points.push({
          x: this.drawPosition.x,
          y: this.drawPosition.y,
          color: "lime",
          label: "Draw",
        })
      }
    }

    return visualization
  }

  /** Returns the redrawn routes. This is the primary output of the solver. */
  getRedrawnHdRoutes(): HighDensityRoute[] {
    return this.redrawnHdRoutes
  }
}
