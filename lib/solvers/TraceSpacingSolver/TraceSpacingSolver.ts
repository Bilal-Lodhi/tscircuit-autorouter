import type { GraphicsObject, Line } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type TraceSpacingSolverConfig = {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  layerCount: number
  obstacleMargin?: number
  minSegmentSize?: number
  substepForceIterations?: number
  traceForceStrength?: number
  obstacleForceStrength?: number
  viaForceMultiplier?: number
  maxMovePerSubstep?: number
  totalIterations?: number
}

type TracePointGroup = {
  id: number
  routeIndex: number
  indices: number[]
  zLayers: number[]
  connectionName: string
  rootConnectionName: string
  traceThickness: number
  viaDiameter: number
  isEndpoint: boolean
  isVia: boolean
  x: number
  y: number
}

type ObstacleWithZLayers = Obstacle & { zLayers: number[] }

type Force = { fx: number; fy: number }

type SegmentSample = {
  x: number
  y: number
  z: number
  routeIndex: number
  groupIds: number[]
  connectionName: string
  rootConnectionName: string
  traceThickness: number
}

export class TraceSpacingSolver extends BaseSolver {
  hdRoutes: HighDensityRoute[]
  obstacleMargin: number
  minSegmentSize: number
  substepForceIterations: number
  traceForceStrength: number
  obstacleForceStrength: number
  viaForceMultiplier: number
  maxMovePerSubstep: number
  totalIterations: number

  private groups: TracePointGroup[]
  private obstacles: ObstacleWithZLayers[]
  private groupIndexByRoutePoint = new Map<number, Map<number, number>>()

  constructor(private config: TraceSpacingSolverConfig) {
    super()
    this.hdRoutes = config.hdRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))
    this.obstacleMargin = config.obstacleMargin ?? 0.15
    this.minSegmentSize = config.minSegmentSize ?? 0.5
    this.substepForceIterations = config.substepForceIterations ?? 10
    this.traceForceStrength = config.traceForceStrength ?? 0.15
    this.obstacleForceStrength = config.obstacleForceStrength ?? 0.3
    this.viaForceMultiplier = config.viaForceMultiplier ?? 1.6
    this.maxMovePerSubstep = config.maxMovePerSubstep ?? 0.1
    this.totalIterations = config.totalIterations ?? 50
    this.MAX_ITERATIONS = this.totalIterations

    this.hdRoutes = this.hdRoutes.map((route) =>
      this.splitRouteSegments(route, this.minSegmentSize),
    )

    this.obstacles = config.obstacles.map((obstacle) => {
      const zLayers =
        obstacle.zLayers ??
        obstacle.layers.map((layer) =>
          mapLayerNameToZ(layer, config.layerCount),
        )
      return {
        ...obstacle,
        zLayers,
      }
    })

    this.groups = this.buildGroups(this.hdRoutes)
    this.updateRouteVias(this.hdRoutes)
  }

  get adjustedHdRoutes(): HighDensityRoute[] {
    return this.hdRoutes
  }

  _step() {
    if (this.iterations >= this.totalIterations) {
      this.solved = true
      return
    }

    for (let substep = 0; substep < this.substepForceIterations; substep++) {
      this.applyForces()
    }

    this.updateRouteVias(this.hdRoutes)

    if (this.iterations >= this.totalIterations) {
      this.solved = true
    }
  }

  private splitRouteSegments(
    route: HighDensityRoute,
    minSegmentSize: number,
  ): HighDensityRoute {
    if (route.route.length < 2) return route
    const newPoints: HighDensityRoute["route"] = []

    for (let i = 0; i < route.route.length - 1; i++) {
      const start = route.route[i]
      const end = route.route[i + 1]
      newPoints.push({ ...start })

      if (start.z !== end.z) {
        continue
      }

      const dx = end.x - start.x
      const dy = end.y - start.y
      const dist = Math.hypot(dx, dy)

      if (dist <= minSegmentSize) {
        continue
      }

      const segments = Math.ceil(dist / minSegmentSize)
      for (let s = 1; s < segments; s++) {
        const t = s / segments
        newPoints.push({
          x: start.x + dx * t,
          y: start.y + dy * t,
          z: start.z,
        })
      }
    }

    const lastPoint = route.route[route.route.length - 1]
    newPoints.push({ ...lastPoint })

    return {
      ...route,
      route: newPoints,
    }
  }

  private buildGroups(routes: HighDensityRoute[]): TracePointGroup[] {
    const groups: TracePointGroup[] = []

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
      const route = routes[routeIndex]
      const groupByPointIndex = new Map<number, number>()
      this.groupIndexByRoutePoint.set(routeIndex, groupByPointIndex)
      const rootName = route.rootConnectionName ?? route.connectionName

      for (let i = 0; i < route.route.length; i++) {
        if (groupByPointIndex.has(i)) continue
        const point = route.route[i]
        const indices = [i]

        const next = route.route[i + 1]
        if (
          next &&
          Math.abs(point.x - next.x) < 1e-6 &&
          Math.abs(point.y - next.y) < 1e-6 &&
          point.z !== next.z
        ) {
          indices.push(i + 1)
        }

        const zLayers = Array.from(
          new Set(indices.map((index) => route.route[index].z)),
        )

        const isEndpoint =
          indices.includes(0) || indices.includes(route.route.length - 1)
        const isVia = indices.length > 1

        const groupId = groups.length
        for (const index of indices) {
          groupByPointIndex.set(index, groupId)
        }

        groups.push({
          id: groupId,
          routeIndex,
          indices,
          zLayers,
          connectionName: route.connectionName,
          rootConnectionName: rootName,
          traceThickness: route.traceThickness,
          viaDiameter: route.viaDiameter,
          isEndpoint,
          isVia,
          x: point.x,
          y: point.y,
        })
      }
    }

    return groups
  }

  private applyForces() {
    const forces: Force[] = this.groups.map(() => ({ fx: 0, fy: 0 }))
    const segmentSamples = this.buildSegmentSamples()

    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i]
      const groupClearance = group.isVia
        ? group.viaDiameter / 2
        : group.traceThickness / 2

      for (let j = i + 1; j < this.groups.length; j++) {
        const other = this.groups[j]
        if (group.rootConnectionName === other.rootConnectionName) continue
        if (!this.layersIntersect(group.zLayers, other.zLayers)) continue

        const otherClearance = other.isVia
          ? other.viaDiameter / 2
          : other.traceThickness / 2
        const requiredSpacing =
          this.obstacleMargin + groupClearance + otherClearance

        const dx = other.x - group.x
        const dy = other.y - group.y
        let dist = Math.hypot(dx, dy)

        if (dist >= requiredSpacing) continue

        let dirX = dx
        let dirY = dy
        if (dist < 1e-6) {
          const angle = (group.id + other.id) * 0.73
          dirX = Math.cos(angle)
          dirY = Math.sin(angle)
          dist = 1
        }

        const overlapRatio = (requiredSpacing - dist) / requiredSpacing
        const forceMultiplier =
          group.isVia || other.isVia ? this.viaForceMultiplier : 1
        const forceMag =
          this.traceForceStrength * overlapRatio * forceMultiplier
        const fx = (dirX / dist) * forceMag
        const fy = (dirY / dist) * forceMag

        forces[i].fx -= fx
        forces[i].fy -= fy
        forces[j].fx += fx
        forces[j].fy += fy
      }

      for (const obstacle of this.obstacles) {
        if (!this.layersIntersect(group.zLayers, obstacle.zLayers)) continue
        if (
          obstacle.connectedTo.includes(group.rootConnectionName) ||
          obstacle.connectedTo.includes(group.connectionName)
        ) {
          continue
        }

        const clearance =
          this.obstacleMargin +
          (group.isVia ? group.viaDiameter / 2 : group.traceThickness / 2)
        const { dist, dirX, dirY } = this.getObstacleRepulsion(
          group.x,
          group.y,
          obstacle,
        )
        if (dist >= clearance) continue

        const overlapRatio = (clearance - dist) / clearance
        const forceMag = this.obstacleForceStrength * overlapRatio
        forces[i].fx += dirX * forceMag
        forces[i].fy += dirY * forceMag
      }
    }

    for (const sample of segmentSamples) {
      const clearance = this.obstacleMargin + sample.traceThickness / 2
      for (const obstacle of this.obstacles) {
        if (!obstacle.zLayers.includes(sample.z)) continue
        if (
          obstacle.connectedTo.includes(sample.rootConnectionName) ||
          obstacle.connectedTo.includes(sample.connectionName)
        ) {
          continue
        }

        const { dist, dirX, dirY } = this.getObstacleRepulsion(
          sample.x,
          sample.y,
          obstacle,
        )
        if (dist >= clearance) continue

        const overlapRatio = (clearance - dist) / clearance
        const forceMag = this.obstacleForceStrength * overlapRatio
        const fx = dirX * forceMag
        const fy = dirY * forceMag
        const share = sample.groupIds.length || 1

        for (const groupId of sample.groupIds) {
          forces[groupId].fx += fx / share
          forces[groupId].fy += fy / share
        }
      }
    }

    for (let i = 0; i < segmentSamples.length; i++) {
      const sample = segmentSamples[i]
      for (let j = i + 1; j < segmentSamples.length; j++) {
        const other = segmentSamples[j]
        if (sample.rootConnectionName === other.rootConnectionName) continue
        if (sample.z !== other.z) continue

        const requiredSpacing =
          this.obstacleMargin +
          sample.traceThickness / 2 +
          other.traceThickness / 2

        const dx = other.x - sample.x
        const dy = other.y - sample.y
        let dist = Math.hypot(dx, dy)

        if (dist >= requiredSpacing) continue

        let dirX = dx
        let dirY = dy
        if (dist < 1e-6) {
          const angle = (i + j) * 0.41
          dirX = Math.cos(angle)
          dirY = Math.sin(angle)
          dist = 1
        }

        const overlapRatio = (requiredSpacing - dist) / requiredSpacing
        const forceMag = this.traceForceStrength * overlapRatio
        const fx = (dirX / dist) * forceMag
        const fy = (dirY / dist) * forceMag
        const sampleShare = sample.groupIds.length || 1
        const otherShare = other.groupIds.length || 1

        for (const groupId of sample.groupIds) {
          forces[groupId].fx -= fx / sampleShare
          forces[groupId].fy -= fy / sampleShare
        }

        for (const groupId of other.groupIds) {
          forces[groupId].fx += fx / otherShare
          forces[groupId].fy += fy / otherShare
        }
      }
    }

    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i]
      if (group.isEndpoint) continue

      let fx = forces[i].fx
      let fy = forces[i].fy
      const forceMag = Math.hypot(fx, fy)
      if (forceMag < 1e-6) continue

      if (forceMag > this.maxMovePerSubstep) {
        const scale = this.maxMovePerSubstep / forceMag
        fx *= scale
        fy *= scale
      }

      group.x += fx
      group.y += fy

      const route = this.hdRoutes[group.routeIndex]
      for (const index of group.indices) {
        route.route[index] = {
          ...route.route[index],
          x: group.x,
          y: group.y,
        }
      }
    }

    this.applyObstacleClearance()
  }

  private applyObstacleClearance() {
    for (const group of this.groups) {
      if (group.isEndpoint) continue
      const clearance =
        this.obstacleMargin +
        (group.isVia ? group.viaDiameter / 2 : group.traceThickness / 2)

      for (const obstacle of this.obstacles) {
        if (!this.layersIntersect(group.zLayers, obstacle.zLayers)) continue
        if (
          obstacle.connectedTo.includes(group.rootConnectionName) ||
          obstacle.connectedTo.includes(group.connectionName)
        ) {
          continue
        }

        const { dist, dirX, dirY } = this.getObstacleRepulsion(
          group.x,
          group.y,
          obstacle,
        )

        if (dist >= clearance) continue
        const moveBy = clearance - dist
        group.x += dirX * moveBy
        group.y += dirY * moveBy

        const route = this.hdRoutes[group.routeIndex]
        for (const index of group.indices) {
          route.route[index] = {
            ...route.route[index],
            x: group.x,
            y: group.y,
          }
        }
      }
    }
  }

  private buildSegmentSamples(): SegmentSample[] {
    const samples: SegmentSample[] = []

    for (let routeIndex = 0; routeIndex < this.hdRoutes.length; routeIndex++) {
      const route = this.hdRoutes[routeIndex]
      const groupMap = this.groupIndexByRoutePoint.get(routeIndex)
      if (!groupMap) continue
      const rootName = route.rootConnectionName ?? route.connectionName

      for (let i = 0; i < route.route.length - 1; i++) {
        const start = route.route[i]
        const end = route.route[i + 1]
        if (start.z !== end.z) continue

        const dx = end.x - start.x
        const dy = end.y - start.y
        const length = Math.hypot(dx, dy)
        const sampleCount = Math.max(
          1,
          Math.floor(length / this.minSegmentSize),
        )

        const groupIdA = groupMap.get(i)
        const groupIdB = groupMap.get(i + 1)
        const groupIds = [groupIdA, groupIdB].filter(
          (value): value is number => value !== undefined,
        )

        for (let s = 1; s <= sampleCount; s++) {
          const t = s / (sampleCount + 1)
          samples.push({
            x: start.x + dx * t,
            y: start.y + dy * t,
            z: start.z,
            routeIndex,
            groupIds,
            connectionName: route.connectionName,
            rootConnectionName: rootName,
            traceThickness: route.traceThickness,
          })
        }
      }
    }

    return samples
  }

  private layersIntersect(a: number[], b: number[]): boolean {
    for (const value of a) {
      if (b.includes(value)) return true
    }
    return false
  }

  private getObstacleRepulsion(
    x: number,
    y: number,
    obstacle: ObstacleWithZLayers,
  ) {
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    const minX = obstacle.center.x - halfWidth
    const maxX = obstacle.center.x + halfWidth
    const minY = obstacle.center.y - halfHeight
    const maxY = obstacle.center.y + halfHeight

    const clampedX = Math.min(maxX, Math.max(minX, x))
    const clampedY = Math.min(maxY, Math.max(minY, y))

    let dirX = x - clampedX
    let dirY = y - clampedY
    let dist = Math.hypot(dirX, dirY)

    if (dist < 1e-6) {
      const left = x - minX
      const right = maxX - x
      const bottom = y - minY
      const top = maxY - y
      const minEdge = Math.min(left, right, bottom, top)

      if (minEdge === left) {
        dirX = -1
        dirY = 0
      } else if (minEdge === right) {
        dirX = 1
        dirY = 0
      } else if (minEdge === bottom) {
        dirX = 0
        dirY = -1
      } else {
        dirX = 0
        dirY = 1
      }

      dist = 0
    }

    return {
      dist,
      dirX: dist < 1e-6 ? dirX : dirX / dist,
      dirY: dist < 1e-6 ? dirY : dirY / dist,
    }
  }

  private updateRouteVias(routes: HighDensityRoute[]) {
    for (const route of routes) {
      const vias: HighDensityRoute["vias"] = []
      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]
        const next = route.route[i + 1]
        if (current.z !== next.z) {
          vias.push({ x: current.x, y: current.y })
        }
      }
      route.vias = vias
    }
  }

  visualize(): GraphicsObject {
    const lines: Line[] = []
    for (const route of this.hdRoutes) {
      if (route.route.length < 2) continue
      lines.push({
        points: route.route.map((point) => ({ x: point.x, y: point.y })),
        strokeColor: "rgba(0, 0, 0, 0.6)",
      })
    }

    return {
      lines,
      rects: this.obstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(255, 0, 0, 0.15)",
      })),
    }
  }
}
