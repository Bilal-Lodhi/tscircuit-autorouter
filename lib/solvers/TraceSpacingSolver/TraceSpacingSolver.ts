import { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import type { GraphicsObject } from "graphics-debug"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"

type Point3 = { x: number; y: number; z: number }

type TraceSegment = {
  start: Point3
  end: Point3
  z: number
  traceThickness: number
  routeIndex: number
  groupName: string
}

type ViaPoint = {
  x: number
  y: number
  viaDiameter: number
  routeIndex: number
  groupName: string
}

export interface TraceSpacingSolverConfig {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  layerCount: number
  obstacleMargin?: number
  minSegmentSize?: number
  substepForceIterations?: number
  maxSteps?: number
  traceForceStrength?: number
  viaForceStrength?: number
  obstacleForceStrength?: number
  segmentObstacleForceStrength?: number
  damping?: number
  maxPointDisplacement?: number
  minMovementToContinue?: number
}

const DEFAULT_OBSTACLE_MARGIN = 0.15
const DEFAULT_MIN_SEGMENT_SIZE = 0.5
const DEFAULT_SUBSTEP_FORCE_ITERATIONS = 4
const DEFAULT_MAX_STEPS = 20
const DEFAULT_TRACE_FORCE = 0.06
const DEFAULT_VIA_FORCE = 0.05
const DEFAULT_OBSTACLE_FORCE = 0.08
const DEFAULT_SEGMENT_OBSTACLE_FORCE = 0.04
const DEFAULT_DAMPING = 0.9
const DEFAULT_MAX_DISPLACEMENT = 0.08
const DEFAULT_MIN_MOVEMENT = 1e-4

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

const getGroupName = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

const splitRouteSegments = (
  route: HighDensityRoute,
  minSegmentSize: number,
): HighDensityRoute => {
  if (route.route.length <= 1) return route
  const newPoints: Point3[] = [route.route[0]]
  for (let i = 0; i < route.route.length - 1; i++) {
    const start = route.route[i]
    const end = route.route[i + 1]
    if (start.z !== end.z) {
      newPoints.push(end)
      continue
    }
    const segmentLength = distance(start, end)
    if (segmentLength <= minSegmentSize) {
      newPoints.push(end)
      continue
    }
    const segments = Math.ceil(segmentLength / minSegmentSize)
    for (let s = 1; s <= segments; s++) {
      const t = s / segments
      newPoints.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z,
      })
    }
  }
  return {
    ...route,
    route: newPoints,
    vias: recomputeVias(newPoints),
  }
}

const recomputeVias = (routePoints: Point3[]) => {
  const vias: Array<{ x: number; y: number }> = []
  for (let i = 1; i < routePoints.length; i++) {
    const prev = routePoints[i - 1]
    const current = routePoints[i]
    if (prev.z !== current.z) {
      vias.push({ x: current.x, y: current.y })
    }
  }
  return vias
}

const closestPointOnSegment = (
  point: { x: number; y: number },
  segment: TraceSegment,
) => {
  const { start, end } = segment
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return { x: start.x, y: start.y }
  const t =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)
  const clamped = clamp(t, 0, 1)
  return { x: start.x + dx * clamped, y: start.y + dy * clamped }
}

const obstacleAppliesToLayer = (
  obstacle: Obstacle,
  z: number,
  layerCount: number,
) => {
  if (obstacle.zLayers) {
    return obstacle.zLayers.includes(z)
  }
  if (obstacle.layers?.length) {
    const layerName = mapZToLayerName(z, layerCount)
    return obstacle.layers.includes(layerName)
  }
  return true
}

const computePointToObstacleForce = ({
  point,
  obstacle,
  margin,
  traceThickness,
  forceStrength,
}: {
  point: Point3
  obstacle: Obstacle
  margin: number
  traceThickness: number
  forceStrength: number
}) => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const minX = obstacle.center.x - halfWidth
  const maxX = obstacle.center.x + halfWidth
  const minY = obstacle.center.y - halfHeight
  const maxY = obstacle.center.y + halfHeight

  const closestX = clamp(point.x, minX, maxX)
  const closestY = clamp(point.y, minY, maxY)
  let dx = point.x - closestX
  let dy = point.y - closestY
  let dist = Math.hypot(dx, dy)

  if (dist < 1e-6) {
    const toLeft = Math.abs(point.x - minX)
    const toRight = Math.abs(maxX - point.x)
    const toBottom = Math.abs(point.y - minY)
    const toTop = Math.abs(maxY - point.y)
    const minEdge = Math.min(toLeft, toRight, toBottom, toTop)
    if (minEdge === toLeft) {
      dx = -1
      dy = 0
      dist = toLeft
    } else if (minEdge === toRight) {
      dx = 1
      dy = 0
      dist = toRight
    } else if (minEdge === toBottom) {
      dx = 0
      dy = -1
      dist = toBottom
    } else {
      dx = 0
      dy = 1
    }
    dist = 0
  }

  const threshold = margin + traceThickness / 2
  if (dist >= threshold) return { fx: 0, fy: 0 }
  const magnitude = ((threshold - dist) / threshold) * forceStrength
  const norm = Math.hypot(dx, dy) || 1
  return { fx: (dx / norm) * magnitude, fy: (dy / norm) * magnitude }
}

const getRepulsionDirection = (
  point: { x: number; y: number },
  obstacle: Obstacle,
) => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const minX = obstacle.center.x - halfWidth
  const maxX = obstacle.center.x + halfWidth
  const minY = obstacle.center.y - halfHeight
  const maxY = obstacle.center.y + halfHeight

  const closestX = clamp(point.x, minX, maxX)
  const closestY = clamp(point.y, minY, maxY)
  let dx = point.x - closestX
  let dy = point.y - closestY
  const dist = Math.hypot(dx, dy)

  if (dist < 1e-6) {
    const toLeft = Math.abs(point.x - minX)
    const toRight = Math.abs(maxX - point.x)
    const toBottom = Math.abs(point.y - minY)
    const toTop = Math.abs(maxY - point.y)
    const minEdge = Math.min(toLeft, toRight, toBottom, toTop)
    if (minEdge === toLeft) {
      dx = -1
      dy = 0
    } else if (minEdge === toRight) {
      dx = 1
      dy = 0
    } else if (minEdge === toBottom) {
      dx = 0
      dy = -1
    } else {
      dx = 0
      dy = 1
    }
  }

  const norm = Math.hypot(dx, dy) || 1
  return { dx: dx / norm, dy: dy / norm }
}

export class TraceSpacingSolver extends BaseSolver {
  hdRoutes: HighDensityRoute[]
  obstacleMargin: number
  minSegmentSize: number
  substepForceIterations: number
  traceForceStrength: number
  viaForceStrength: number
  obstacleForceStrength: number
  segmentObstacleForceStrength: number
  damping: number
  maxPointDisplacement: number
  minMovementToContinue: number
  obstacles: Obstacle[]
  layerCount: number

  constructor(private config: TraceSpacingSolverConfig) {
    super()
    this.obstacleMargin = config.obstacleMargin ?? DEFAULT_OBSTACLE_MARGIN
    this.minSegmentSize = config.minSegmentSize ?? DEFAULT_MIN_SEGMENT_SIZE
    this.substepForceIterations =
      config.substepForceIterations ?? DEFAULT_SUBSTEP_FORCE_ITERATIONS
    this.traceForceStrength = config.traceForceStrength ?? DEFAULT_TRACE_FORCE
    this.viaForceStrength = config.viaForceStrength ?? DEFAULT_VIA_FORCE
    this.obstacleForceStrength =
      config.obstacleForceStrength ?? DEFAULT_OBSTACLE_FORCE
    this.segmentObstacleForceStrength =
      config.segmentObstacleForceStrength ?? DEFAULT_SEGMENT_OBSTACLE_FORCE
    this.damping = config.damping ?? DEFAULT_DAMPING
    this.maxPointDisplacement =
      config.maxPointDisplacement ?? DEFAULT_MAX_DISPLACEMENT
    this.minMovementToContinue =
      config.minMovementToContinue ?? DEFAULT_MIN_MOVEMENT
    this.layerCount = config.layerCount
    this.obstacles = config.obstacles
    this.hdRoutes = config.hdRoutes.map((route) =>
      splitRouteSegments(
        {
          ...route,
          route: route.route.map((point) => ({ ...point })),
          vias: route.vias.map((via) => ({ ...via })),
        },
        this.minSegmentSize,
      ),
    )
    this.MAX_ITERATIONS = config.maxSteps ?? DEFAULT_MAX_STEPS
  }

  getOptimizedHdRoutes() {
    return this.hdRoutes
  }

  private buildSegments(): TraceSegment[] {
    const segments: TraceSegment[] = []
    this.hdRoutes.forEach((route, routeIndex) => {
      const groupName = getGroupName(route)
      for (let i = 0; i < route.route.length - 1; i++) {
        const start = route.route[i]
        const end = route.route[i + 1]
        if (start.z !== end.z) continue
        segments.push({
          start,
          end,
          z: start.z,
          traceThickness: route.traceThickness,
          routeIndex,
          groupName,
        })
      }
    })
    return segments
  }

  private buildViaPoints(): ViaPoint[] {
    const vias: ViaPoint[] = []
    this.hdRoutes.forEach((route, routeIndex) => {
      const groupName = getGroupName(route)
      for (const via of route.vias) {
        vias.push({
          x: via.x,
          y: via.y,
          viaDiameter: route.viaDiameter,
          routeIndex,
          groupName,
        })
      }
    })
    return vias
  }

  private isObstacleConnectedToRoute(
    obstacle: Obstacle,
    route: HighDensityRoute,
  ) {
    const identifiers = [route.connectionName, route.rootConnectionName].filter(
      Boolean,
    ) as string[]
    return identifiers.some((id) => obstacle.connectedTo?.includes(id))
  }

  private isPointAnchoredToConnectedObstacle(
    route: HighDensityRoute,
    point: Point3,
  ) {
    return this.obstacles.some((obstacle) => {
      if (!this.isObstacleConnectedToRoute(obstacle, route)) return false
      if (!obstacleAppliesToLayer(obstacle, point.z, this.layerCount))
        return false
      const halfWidth = obstacle.width / 2
      const halfHeight = obstacle.height / 2
      return (
        Math.abs(point.x - obstacle.center.x) <= halfWidth + 0.01 &&
        Math.abs(point.y - obstacle.center.y) <= halfHeight + 0.01
      )
    })
  }

  private applyForcesOnce(): number {
    const segments = this.buildSegments()
    const vias = this.buildViaPoints()
    let totalMovement = 0

    this.hdRoutes.forEach((route, routeIndex) => {
      const groupName = getGroupName(route)
      for (let i = 0; i < route.route.length; i++) {
        if (route.route.length === 0) continue
        if (route.route.length === 1) continue
        const point = route.route[i]
        const isEndpoint = i === 0 || i === route.route.length - 1
        if (isEndpoint && this.isPointAnchoredToConnectedObstacle(route, point))
          continue
        let fx = 0
        let fy = 0

        for (const segment of segments) {
          if (segment.routeIndex === routeIndex) continue
          if (segment.groupName === groupName) continue
          if (segment.z !== point.z) continue
          const closest = closestPointOnSegment(point, segment)
          const dist = distance(point, closest)
          const threshold =
            this.obstacleMargin +
            (route.traceThickness + segment.traceThickness) / 2
          if (dist >= threshold) continue
          const magnitude =
            ((threshold - dist) / threshold) * this.traceForceStrength
          const dx = point.x - closest.x
          const dy = point.y - closest.y
          const norm = Math.hypot(dx, dy) || 1
          fx += (dx / norm) * magnitude
          fy += (dy / norm) * magnitude
        }

        for (const via of vias) {
          if (via.routeIndex === routeIndex) continue
          if (via.groupName === groupName) continue
          const dist = Math.hypot(point.x - via.x, point.y - via.y)
          const threshold =
            this.obstacleMargin + route.traceThickness / 2 + via.viaDiameter / 2
          if (dist >= threshold) continue
          const magnitude =
            ((threshold - dist) / threshold) * this.viaForceStrength
          const dx = point.x - via.x
          const dy = point.y - via.y
          const norm = Math.hypot(dx, dy) || 1
          fx += (dx / norm) * magnitude
          fy += (dy / norm) * magnitude
        }

        for (const obstacle of this.obstacles) {
          if (!obstacleAppliesToLayer(obstacle, point.z, this.layerCount))
            continue
          if (
            isEndpoint &&
            this.isPointAnchoredToConnectedObstacle(route, point)
          )
            continue
          const obstacleForce = computePointToObstacleForce({
            point,
            obstacle,
            margin: this.obstacleMargin,
            traceThickness: route.traceThickness,
            forceStrength: this.obstacleForceStrength,
          })
          fx += obstacleForce.fx
          fy += obstacleForce.fy
        }

        fx *= this.damping
        fy *= this.damping
        if (
          Math.abs(fx) < this.minMovementToContinue &&
          Math.abs(fy) < this.minMovementToContinue
        ) {
          continue
        }
        const dx = clamp(
          fx,
          -this.maxPointDisplacement,
          this.maxPointDisplacement,
        )
        const dy = clamp(
          fy,
          -this.maxPointDisplacement,
          this.maxPointDisplacement,
        )
        point.x += dx
        point.y += dy
        totalMovement += Math.hypot(dx, dy)
      }
    })

    this.hdRoutes.forEach((route, routeIndex) => {
      for (let i = 0; i < route.route.length - 1; i++) {
        const start = route.route[i]
        const end = route.route[i + 1]
        if (start.z !== end.z) continue
        for (const obstacle of this.obstacles) {
          if (!obstacleAppliesToLayer(obstacle, start.z, this.layerCount))
            continue
          const dist = segmentToBoxMinDistance(start, end, obstacle)
          const threshold = this.obstacleMargin + route.traceThickness / 2
          if (dist >= threshold) continue
          const magnitude =
            ((threshold - dist) / threshold) * this.segmentObstacleForceStrength
          const midpoint = {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
          }
          const direction = getRepulsionDirection(midpoint, obstacle)
          const fx = direction.dx * magnitude * 0.5
          const fy = direction.dy * magnitude * 0.5
          if (
            !(i === 0 && this.isPointAnchoredToConnectedObstacle(route, start))
          ) {
            start.x += clamp(
              fx,
              -this.maxPointDisplacement,
              this.maxPointDisplacement,
            )
            start.y += clamp(
              fy,
              -this.maxPointDisplacement,
              this.maxPointDisplacement,
            )
          }
          if (
            !(
              i + 1 === route.route.length - 1 &&
              this.isPointAnchoredToConnectedObstacle(route, end)
            )
          ) {
            end.x += clamp(
              fx,
              -this.maxPointDisplacement,
              this.maxPointDisplacement,
            )
            end.y += clamp(
              fy,
              -this.maxPointDisplacement,
              this.maxPointDisplacement,
            )
          }
        }
      }
    })

    this.hdRoutes = this.hdRoutes.map((route) => ({
      ...route,
      vias: recomputeVias(route.route),
    }))

    return totalMovement
  }

  _step() {
    if (this.solved) return
    let movement = 0
    for (let i = 0; i < this.substepForceIterations; i++) {
      movement += this.applyForcesOnce()
    }

    if (movement < this.minMovementToContinue) {
      this.solved = true
    }
  }

  tryFinalAcceptance() {
    this.solved = true
  }

  visualize(): GraphicsObject {
    const visualization: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Trace Spacing Solver",
    }

    for (const obstacle of this.obstacles) {
      visualization.rects?.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(128, 128, 128, 0.2)",
      })
    }

    for (const route of this.hdRoutes) {
      for (let i = 0; i < route.route.length - 1; i++) {
        const a = route.route[i]
        const b = route.route[i + 1]
        if (a.z !== b.z) continue
        visualization.lines?.push({
          points: [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ],
          strokeColor: a.z === 0 ? "red" : "blue",
          strokeWidth: route.traceThickness,
        })
      }
      for (const via of route.vias) {
        visualization.circles?.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(255, 0, 255, 0.5)",
        })
      }
    }

    return visualization
  }
}
