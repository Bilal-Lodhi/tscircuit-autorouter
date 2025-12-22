import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../BaseSolver"

type Point2 = { x: number; y: number }
type RoutePoint = { x: number; y: number; z: number }
type RouteSegment = {
  start: RoutePoint
  end: RoutePoint
  z: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  startIndex: number
  endIndex: number
}

export interface TraceSpacingForceSolverParams {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  hyperParameters?: Partial<TraceSpacingForceHyperParameters>
  colorMap?: Record<string, string>
}

export interface TraceSpacingForceHyperParameters {
  obstacleMargin: number
  minSegmentSize: number
  substepForceIterations: number
  traceForceStrength: number
  obstacleForceStrength: number
  viaForceMultiplier: number
  endpointForceMultiplier: number
  maxStepDistance: number
  damping: number
  maxIterations: number
}

type ViaGroup = {
  pointIndices: number[]
}

export class TraceSpacingForceSolver extends BaseSolver {
  OBSTACLE_MARGIN = 0.15
  MIN_SEGMENT_SIZE = 0.25
  SUBSTEP_FORCE_ITERATIONS = 8
  TRACE_FORCE_STRENGTH = 0.15
  OBSTACLE_FORCE_STRENGTH = 0.4
  VIA_FORCE_MULTIPLIER = 1.6
  ENDPOINT_FORCE_MULTIPLIER = 1
  CLEARANCE_BUFFER = 0.05
  MAX_STEP_DISTANCE = 0.2
  DAMPING = 0.9
  MOVEMENT_EPSILON = 0.0005

  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  colorMap?: Record<string, string>

  routePoints: RoutePoint[][] = []
  viaGroups: ViaGroup[][] = []
  routeRootNames: string[] = []
  routeTraceThickness: number[] = []

  constructor({
    hdRoutes,
    obstacles,
    connMap,
    layerCount,
    bounds,
    hyperParameters,
    colorMap,
  }: TraceSpacingForceSolverParams) {
    super()
    this.hdRoutes = hdRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))
    this.obstacles = obstacles
    this.connMap = connMap
    this.layerCount = layerCount
    this.bounds = bounds
    this.colorMap = colorMap

    if (hyperParameters?.obstacleMargin !== undefined) {
      this.OBSTACLE_MARGIN = hyperParameters.obstacleMargin
    }
    if (hyperParameters?.minSegmentSize !== undefined) {
      this.MIN_SEGMENT_SIZE = hyperParameters.minSegmentSize
    }
    if (hyperParameters?.substepForceIterations !== undefined) {
      this.SUBSTEP_FORCE_ITERATIONS = hyperParameters.substepForceIterations
    }
    if (hyperParameters?.traceForceStrength !== undefined) {
      this.TRACE_FORCE_STRENGTH = hyperParameters.traceForceStrength
    }
    if (hyperParameters?.obstacleForceStrength !== undefined) {
      this.OBSTACLE_FORCE_STRENGTH = hyperParameters.obstacleForceStrength
    }
    if (hyperParameters?.viaForceMultiplier !== undefined) {
      this.VIA_FORCE_MULTIPLIER = hyperParameters.viaForceMultiplier
    }
    if (hyperParameters?.endpointForceMultiplier !== undefined) {
      this.ENDPOINT_FORCE_MULTIPLIER = hyperParameters.endpointForceMultiplier
    }
    if (hyperParameters?.maxStepDistance !== undefined) {
      this.MAX_STEP_DISTANCE = hyperParameters.maxStepDistance
    }
    if (hyperParameters?.damping !== undefined) {
      this.DAMPING = hyperParameters.damping
    }
    if (hyperParameters?.maxIterations !== undefined) {
      this.MAX_ITERATIONS = hyperParameters.maxIterations
    } else {
      this.MAX_ITERATIONS = 120
    }

    this.initializeRoutePoints()
  }

  get adjustedHdRoutes(): HighDensityRoute[] {
    return this.hdRoutes.map((route, routeIndex) => ({
      ...route,
      route: this.routePoints[routeIndex].map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      })),
      vias: collectViaPoints(this.routePoints[routeIndex]),
    }))
  }

  initializeRoutePoints() {
    this.routePoints = []
    this.viaGroups = []
    this.routeRootNames = []
    this.routeTraceThickness = []

    for (const route of this.hdRoutes) {
      const expanded = splitRouteBySegmentSize(
        route.route,
        this.MIN_SEGMENT_SIZE,
      )
      this.routePoints.push(expanded)
      this.viaGroups.push(buildViaGroups(expanded))
      this.routeRootNames.push(route.rootConnectionName ?? route.connectionName)
      this.routeTraceThickness.push(route.traceThickness ?? 0.1)
    }
  }

  _step() {
    let totalMovement = 0

    for (let i = 0; i < this.SUBSTEP_FORCE_ITERATIONS; i++) {
      const movement = this.applyForcesOnce()
      totalMovement += movement
      if (movement < this.MOVEMENT_EPSILON) {
        this.enforceObstacleClearance()
        this.solved = true
        return
      }
    }

    if (totalMovement < this.MOVEMENT_EPSILON) {
      this.enforceObstacleClearance()
      this.solved = true
    }
  }

  applyForcesOnce(): number {
    const routeSegments = this.routePoints.map((points) =>
      buildRouteSegments(points),
    )
    let totalMovement = 0

    for (
      let routeIndex = 0;
      routeIndex < this.routePoints.length;
      routeIndex++
    ) {
      const points = this.routePoints[routeIndex]
      const viaGroups = this.viaGroups[routeIndex]
      const groupByIndex = new Map<number, ViaGroup>()

      for (const group of viaGroups) {
        for (const pointIndex of group.pointIndices) {
          groupByIndex.set(pointIndex, group)
        }
      }

      const rootName = this.routeRootNames[routeIndex]
      const traceThickness = this.routeTraceThickness[routeIndex]

      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        const isEndpoint = pointIndex === 0 || pointIndex === points.length - 1

        const group = groupByIndex.get(pointIndex)
        if (group && group.pointIndices[0] !== pointIndex) {
          continue
        }

        const point = points[pointIndex]
        let fx = 0
        let fy = 0

        for (
          let otherRoute = 0;
          otherRoute < routeSegments.length;
          otherRoute++
        ) {
          if (otherRoute === routeIndex) continue
          if (this.routeRootNames[otherRoute] === rootName) continue

          const otherThickness = this.routeTraceThickness[otherRoute]
          const effectiveMargin =
            this.OBSTACLE_MARGIN +
            (traceThickness + otherThickness) / 2 +
            this.CLEARANCE_BUFFER
          for (const segment of routeSegments[otherRoute]) {
            if (segment.z !== point.z) continue
            if (
              point.x < segment.minX - effectiveMargin ||
              point.x > segment.maxX + effectiveMargin ||
              point.y < segment.minY - effectiveMargin ||
              point.y > segment.maxY + effectiveMargin
            ) {
              continue
            }
            const closest = pointToSegmentClosestPoint(
              { x: point.x, y: point.y },
              { x: segment.start.x, y: segment.start.y },
              { x: segment.end.x, y: segment.end.y },
            )
            const dx = point.x - closest.x
            const dy = point.y - closest.y
            const dist = Math.hypot(dx, dy)
            if (dist < 1e-6 || dist >= effectiveMargin) continue
            const forceMag =
              (this.TRACE_FORCE_STRENGTH * (effectiveMargin - dist)) /
              effectiveMargin
            fx += (dx / dist) * forceMag
            fy += (dy / dist) * forceMag
          }
        }

        for (const obstacle of this.obstacles) {
          if (!doesObstacleApplyToLayer(obstacle, point.z, this.layerCount)) {
            continue
          }
          if (isObstacleConnectedToRoute(obstacle, rootName)) {
            continue
          }
          const halfWidth = obstacle.width / 2
          const halfHeight = obstacle.height / 2
          const effectiveMargin =
            this.OBSTACLE_MARGIN + traceThickness / 2 + this.CLEARANCE_BUFFER
          if (
            Math.abs(point.x - obstacle.center.x) >
              halfWidth + effectiveMargin ||
            Math.abs(point.y - obstacle.center.y) > halfHeight + effectiveMargin
          ) {
            continue
          }
          const { closestPoint, distance } = getClosestPointOnObstacle(
            point,
            obstacle,
          )
          if (distance >= effectiveMargin) continue
          const dx = point.x - closestPoint.x
          const dy = point.y - closestPoint.y
          const dist = Math.hypot(dx, dy)
          if (dist < 1e-6) continue
          const forceMag =
            (this.OBSTACLE_FORCE_STRENGTH * (effectiveMargin - distance)) /
            effectiveMargin
          fx += (dx / dist) * forceMag
          fy += (dy / dist) * forceMag
        }

        const viaMultiplier =
          group && group.pointIndices.length > 1 ? this.VIA_FORCE_MULTIPLIER : 1
        const endpointMultiplier = isEndpoint
          ? this.ENDPOINT_FORCE_MULTIPLIER
          : 1
        fx *= viaMultiplier * endpointMultiplier
        fy *= viaMultiplier * endpointMultiplier

        const stepFx = fx * this.DAMPING
        const stepFy = fy * this.DAMPING
        const stepMag = Math.hypot(stepFx, stepFy)
        if (stepMag < this.MOVEMENT_EPSILON) continue

        const stepScale =
          stepMag > this.MAX_STEP_DISTANCE
            ? this.MAX_STEP_DISTANCE / stepMag
            : 1
        const deltaX = stepFx * stepScale
        const deltaY = stepFy * stepScale

        const newX = clamp(point.x + deltaX, this.bounds.minX, this.bounds.maxX)
        const newY = clamp(point.y + deltaY, this.bounds.minY, this.bounds.maxY)
        const appliedDx = newX - point.x
        const appliedDy = newY - point.y

        if (group) {
          for (const idx of group.pointIndices) {
            points[idx].x += appliedDx
            points[idx].y += appliedDy
          }
        } else {
          point.x = newX
          point.y = newY
        }
        totalMovement += Math.hypot(appliedDx, appliedDy)
      }
    }

    return totalMovement
  }

  visualize(): GraphicsObject {
    const lines = this.routePoints.flatMap((route, routeIndex) =>
      route.slice(1).map((point, pointIndex) => ({
        points: [route[pointIndex], point],
        strokeColor:
          this.colorMap?.[this.routeRootNames[routeIndex]] ?? "#00a4ff",
      })),
    )
    return { lines }
  }

  tryFinalAcceptance() {
    this.enforceObstacleClearance()
    this.solved = true
  }

  private enforceObstacleClearance() {
    for (
      let routeIndex = 0;
      routeIndex < this.routePoints.length;
      routeIndex++
    ) {
      const points = this.routePoints[routeIndex]
      const viaGroups = this.viaGroups[routeIndex]
      const groupByIndex = new Map<number, ViaGroup>()

      for (const group of viaGroups) {
        for (const pointIndex of group.pointIndices) {
          groupByIndex.set(pointIndex, group)
        }
      }

      const rootName = this.routeRootNames[routeIndex]
      const traceThickness = this.routeTraceThickness[routeIndex]
      const effectiveMargin =
        this.OBSTACLE_MARGIN + traceThickness / 2 + this.CLEARANCE_BUFFER

      const applyDeltaToPoint = (
        pointIndex: number,
        dx: number,
        dy: number,
      ) => {
        const group = groupByIndex.get(pointIndex)
        if (group) {
          for (const idx of group.pointIndices) {
            points[idx].x = clamp(
              points[idx].x + dx,
              this.bounds.minX,
              this.bounds.maxX,
            )
            points[idx].y = clamp(
              points[idx].y + dy,
              this.bounds.minY,
              this.bounds.maxY,
            )
          }
          return
        }
        points[pointIndex].x = clamp(
          points[pointIndex].x + dx,
          this.bounds.minX,
          this.bounds.maxX,
        )
        points[pointIndex].y = clamp(
          points[pointIndex].y + dy,
          this.bounds.minY,
          this.bounds.maxY,
        )
      }

      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        const group = groupByIndex.get(pointIndex)
        if (group && group.pointIndices[0] !== pointIndex) continue

        const point = points[pointIndex]
        let adjustedX = point.x
        let adjustedY = point.y

        for (const obstacle of this.obstacles) {
          if (!doesObstacleApplyToLayer(obstacle, point.z, this.layerCount)) {
            continue
          }
          if (isObstacleConnectedToRoute(obstacle, rootName)) {
            continue
          }

          const halfWidth = obstacle.width / 2
          const halfHeight = obstacle.height / 2
          if (
            Math.abs(adjustedX - obstacle.center.x) >
              halfWidth + effectiveMargin ||
            Math.abs(adjustedY - obstacle.center.y) >
              halfHeight + effectiveMargin
          ) {
            continue
          }

          const { closestPoint, distance } = getClosestPointOnObstacle(
            { x: adjustedX, y: adjustedY },
            obstacle,
          )
          if (distance >= effectiveMargin) continue

          const dx = adjustedX - closestPoint.x
          const dy = adjustedY - closestPoint.y
          const dist = Math.hypot(dx, dy)
          if (dist < 1e-6) continue

          const pushDistance = effectiveMargin - dist + 0.01
          adjustedX += (dx / dist) * pushDistance
          adjustedY += (dy / dist) * pushDistance

          adjustedX = clamp(adjustedX, this.bounds.minX, this.bounds.maxX)
          adjustedY = clamp(adjustedY, this.bounds.minY, this.bounds.maxY)
        }

        const deltaX = adjustedX - point.x
        const deltaY = adjustedY - point.y

        if (Math.hypot(deltaX, deltaY) < 1e-6) continue

        applyDeltaToPoint(pointIndex, deltaX, deltaY)
      }
    }
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const splitRouteBySegmentSize = (
  points: RoutePoint[],
  minSegmentSize: number,
): RoutePoint[] => {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const output: RoutePoint[] = [{ ...points[0] }]

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (start.z !== end.z) {
      output.push({ ...end })
      continue
    }

    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length <= minSegmentSize || length === 0) {
      output.push({ ...end })
      continue
    }

    const segments = Math.ceil(length / minSegmentSize)
    for (let s = 1; s < segments; s++) {
      const t = s / segments
      output.push({
        x: start.x + dx * t,
        y: start.y + dy * t,
        z: start.z,
      })
    }
    output.push({ ...end })
  }

  return output
}

const buildViaGroups = (points: RoutePoint[]): ViaGroup[] => {
  const groups: ViaGroup[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    if (current.x === next.x && current.y === next.y && current.z !== next.z) {
      groups.push({ pointIndices: [i, i + 1] })
    }
  }

  return groups
}

const buildRouteSegments = (points: RoutePoint[]): RouteSegment[] => {
  const segments: RouteSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (start.z !== end.z) continue
    segments.push({
      start,
      end,
      z: start.z,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
      startIndex: i,
      endIndex: i + 1,
    })
  }
  return segments
}

const doesObstacleApplyToLayer = (
  obstacle: Obstacle,
  z: number,
  layerCount: number,
): boolean => {
  if (obstacle.zLayers) {
    return obstacle.zLayers.includes(z)
  }
  return obstacle.layers.some(
    (layer) => mapLayerNameToZ(layer, layerCount) === z,
  )
}

const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  rootConnectionName: string,
) => {
  const connectedIds = new Set([
    ...obstacle.connectedTo,
    ...(obstacle.offBoardConnectsTo ?? []),
  ])
  return connectedIds.has(rootConnectionName)
}

const getClosestPointOnObstacle = (
  point: Point2,
  obstacle: Obstacle,
): { closestPoint: Point2; distance: number } => {
  const minX = obstacle.center.x - obstacle.width / 2
  const maxX = obstacle.center.x + obstacle.width / 2
  const minY = obstacle.center.y - obstacle.height / 2
  const maxY = obstacle.center.y + obstacle.height / 2

  const inside =
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY

  if (inside) {
    const distances = [
      { dist: point.x - minX, x: minX, y: point.y },
      { dist: maxX - point.x, x: maxX, y: point.y },
      { dist: point.y - minY, x: point.x, y: minY },
      { dist: maxY - point.y, x: point.x, y: maxY },
    ]
    distances.sort((a, b) => a.dist - b.dist)
    const closest = distances[0]
    return {
      closestPoint: { x: closest.x, y: closest.y },
      distance: 0,
    }
  }

  const clampedX = clamp(point.x, minX, maxX)
  const clampedY = clamp(point.y, minY, maxY)
  const distance = Math.hypot(point.x - clampedX, point.y - clampedY)
  return { closestPoint: { x: clampedX, y: clampedY }, distance }
}

const collectViaPoints = (
  points: RoutePoint[],
): Array<{ x: number; y: number }> => {
  const viaSet = new Map<string, { x: number; y: number }>()
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    if (current.z !== next.z) {
      const key = `${current.x.toFixed(6)}:${current.y.toFixed(6)}`
      viaSet.set(key, { x: current.x, y: current.y })
    }
  }
  return Array.from(viaSet.values())
}
