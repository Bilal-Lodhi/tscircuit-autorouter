import { GraphicsObject } from "graphics-debug"
import { SimpleRouteConnection } from "lib/types"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../BaseSolver"
import { safeTransparentize } from "../colors"

type RoutePoint = { x: number; y: number; z: number }

type RouteSegmentDescriptor = {
  route: HighDensityIntraNodeRoute
  startKey: string
  endKey: string
  startPoint: RoutePoint
  endPoint: RoutePoint
}

type OrderedRouteSegment = {
  route: HighDensityIntraNodeRoute
  reverse: boolean
}

export type UnsolvedRoute = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start?: RoutePoint
  end?: RoutePoint
}

const POINT_MATCH_TOLERANCE = 1e-3

const roundedPointHash = (p: RoutePoint) =>
  `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`

const pointsMatch = (a: RoutePoint, b: RoutePoint) =>
  Math.abs(a.x - b.x) <= POINT_MATCH_TOLERANCE &&
  Math.abs(a.y - b.y) <= POINT_MATCH_TOLERANCE &&
  Math.abs(a.z - b.z) <= POINT_MATCH_TOLERANCE

const pointsMatchXY = (
  a: Pick<RoutePoint, "x" | "y">,
  b: Pick<RoutePoint, "x" | "y">,
) =>
  Math.abs(a.x - b.x) <= POINT_MATCH_TOLERANCE &&
  Math.abs(a.y - b.y) <= POINT_MATCH_TOLERANCE

const getEndpointKey = (
  route: HighDensityIntraNodeRoute,
  side: "start" | "end",
) => {
  const portPointId =
    side === "start" ? route.startPortPointId : route.endPortPointId
  if (portPointId) {
    return `port:${portPointId}`
  }

  const endpoint =
    side === "start" ? route.route[0]! : route.route[route.route.length - 1]!
  return `point:${roundedPointHash(endpoint)}`
}

export class MultipleHighDensityRouteStitchSolver extends BaseSolver {
  override getSolverName(): string {
    return "MultipleHighDensityRouteStitchSolver"
  }

  unsolvedRoutes: UnsolvedRoute[]
  mergedHdRoutes: HighDensityIntraNodeRoute[] = []
  colorMap: Record<string, string> = {}
  defaultTraceThickness: number
  defaultViaDiameter: number

  constructor(params: {
    connections: SimpleRouteConnection[]
    hdRoutes: HighDensityIntraNodeRoute[]
    colorMap?: Record<string, string>
    layerCount: number
    defaultViaDiameter?: number
  }) {
    super()
    this.colorMap = params.colorMap ?? {}

    const firstRoute = params.hdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.3

    const routesByConnection = new Map<string, HighDensityIntraNodeRoute[]>()
    for (const hdRoute of params.hdRoutes) {
      const routes = routesByConnection.get(hdRoute.connectionName) ?? []
      routes.push(hdRoute)
      routesByConnection.set(hdRoute.connectionName, routes)
    }

    this.unsolvedRoutes = Array.from(routesByConnection.entries()).map(
      ([connectionName, hdRoutes]) => {
        const connection = params.connections.find(
          (candidate) => candidate.name === connectionName,
        )

        return {
          connectionName,
          hdRoutes,
          ...(connection
            ? {
                start: {
                  ...connection.pointsToConnect[0],
                  z: mapLayerNameToZ(
                    getConnectionPointLayer(connection.pointsToConnect[0]),
                    params.layerCount,
                  ),
                },
                end: {
                  ...connection.pointsToConnect[1],
                  z: mapLayerNameToZ(
                    getConnectionPointLayer(connection.pointsToConnect[1]),
                    params.layerCount,
                  ),
                },
              }
            : {}),
        }
      },
    )

    this.MAX_ITERATIONS = 100e3
  }

  private createDirectRoute(
    unsolvedRoute: UnsolvedRoute,
  ): HighDensityIntraNodeRoute | null {
    if (!unsolvedRoute.start || !unsolvedRoute.end) {
      return null
    }

    const route: RoutePoint[] = [
      { ...unsolvedRoute.start },
      ...(unsolvedRoute.start.z !== unsolvedRoute.end.z
        ? [{ x: unsolvedRoute.start.x, y: unsolvedRoute.start.y, z: unsolvedRoute.end.z }]
        : []),
      { ...unsolvedRoute.end },
    ].filter(
      (point, index, points) => index === 0 || !pointsMatch(point, points[index - 1]!),
    )

    return {
      connectionName: unsolvedRoute.connectionName,
      traceThickness: this.defaultTraceThickness,
      viaDiameter: this.defaultViaDiameter,
      route,
      vias:
        unsolvedRoute.start.z !== unsolvedRoute.end.z
          ? [{ x: unsolvedRoute.start.x, y: unsolvedRoute.start.y }]
          : [],
      jumpers: [],
    }
  }

  private createSegmentDescriptors(
    hdRoutes: HighDensityIntraNodeRoute[],
  ): RouteSegmentDescriptor[] {
    return hdRoutes
      .filter((route) => route.route.length > 0)
      .map((route) => ({
        route,
        startKey: getEndpointKey(route, "start"),
        endKey: getEndpointKey(route, "end"),
        startPoint: route.route[0]!,
        endPoint: route.route[route.route.length - 1]!,
      }))
  }

  private buildEndpointAdjacency(
    segments: RouteSegmentDescriptor[],
  ): Map<string, number[]> {
    const adjacency = new Map<string, number[]>()

    const addAdjacency = (key: string, segmentIndex: number) => {
      const indexes = adjacency.get(key) ?? []
      indexes.push(segmentIndex)
      adjacency.set(key, indexes)
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      addAdjacency(segment.startKey, i)
      if (segment.endKey !== segment.startKey) {
        addAdjacency(segment.endKey, i)
      }
    }

    return adjacency
  }

  private getConnectedComponents(
    segments: RouteSegmentDescriptor[],
  ): RouteSegmentDescriptor[][] {
    const adjacency = this.buildEndpointAdjacency(segments)
    const unvisited = new Set(segments.map((_, index) => index))
    const components: RouteSegmentDescriptor[][] = []

    while (unvisited.size > 0) {
      const seedIndex = unvisited.values().next().value as number
      const queue = [seedIndex]
      const componentIndexes: number[] = []
      unvisited.delete(seedIndex)

      while (queue.length > 0) {
        const currentIndex = queue.pop()!
        componentIndexes.push(currentIndex)

        const segment = segments[currentIndex]!
        for (const key of [segment.startKey, segment.endKey]) {
          for (const neighborIndex of adjacency.get(key) ?? []) {
            if (!unvisited.has(neighborIndex)) continue
            unvisited.delete(neighborIndex)
            queue.push(neighborIndex)
          }
        }
      }

      components.push(componentIndexes.map((index) => segments[index]!))
    }

    return components
  }

  private componentHasEndpointMatching(
    component: RouteSegmentDescriptor[],
    key: string,
    point: RoutePoint,
  ) {
    return component.some(
      (segment) =>
        (segment.startKey === key && pointsMatchXY(segment.startPoint, point)) ||
        (segment.endKey === key && pointsMatchXY(segment.endPoint, point)),
    )
  }

  private getPreferredStartKey(
    component: RouteSegmentDescriptor[],
    preferredStart?: RoutePoint,
  ) {
    const degreeByKey = new Map<string, number>()
    for (const segment of component) {
      if (segment.startKey === segment.endKey) {
        degreeByKey.set(
          segment.startKey,
          (degreeByKey.get(segment.startKey) ?? 0) + 2,
        )
        continue
      }

      degreeByKey.set(
        segment.startKey,
        (degreeByKey.get(segment.startKey) ?? 0) + 1,
      )
      degreeByKey.set(segment.endKey, (degreeByKey.get(segment.endKey) ?? 0) + 1)
    }

    const endpointKeys = Array.from(degreeByKey.entries())
      .filter(([, degree]) => degree === 1)
      .map(([key]) => key)

    if (preferredStart) {
      const matchingEndpointKey = endpointKeys.find((key) =>
        this.componentHasEndpointMatching(component, key, preferredStart),
      )
      if (matchingEndpointKey) {
        return matchingEndpointKey
      }
    }

    return endpointKeys[0] ?? component[0]?.startKey
  }

  private selectNextSegmentIndex(
    candidateIndexes: number[],
    component: RouteSegmentDescriptor[],
    adjacency: Map<string, number[]>,
    unusedIndexes: Set<number>,
    currentKey: string,
  ) {
    if (candidateIndexes.length === 1) {
      return candidateIndexes[0]!
    }

    const terminalCandidate = candidateIndexes.find((segmentIndex) => {
      const segment = component[segmentIndex]!
      const otherKey =
        segment.startKey === currentKey ? segment.endKey : segment.startKey
      const remainingNeighborCount = (adjacency.get(otherKey) ?? []).filter(
        (neighborIndex) => unusedIndexes.has(neighborIndex) && neighborIndex !== segmentIndex,
      ).length
      return remainingNeighborCount === 0
    })

    return terminalCandidate ?? candidateIndexes[0]!
  }

  private orderComponentRoutes(
    component: RouteSegmentDescriptor[],
    preferredStart?: RoutePoint,
  ): OrderedRouteSegment[] {
    const adjacency = this.buildEndpointAdjacency(component)
    const unusedIndexes = new Set(component.map((_, index) => index))
    const orderedSegments: OrderedRouteSegment[] = []
    let currentKey = this.getPreferredStartKey(component, preferredStart)

    const flushSelfLoopsAtCurrentKey = () => {
      if (!currentKey) return

      for (const segmentIndex of adjacency.get(currentKey) ?? []) {
        if (!unusedIndexes.has(segmentIndex)) continue
        const segment = component[segmentIndex]!
        if (segment.startKey !== segment.endKey) continue
        unusedIndexes.delete(segmentIndex)
        orderedSegments.push({
          route: segment.route,
          reverse: false,
        })
      }
    }

    flushSelfLoopsAtCurrentKey()

    while (unusedIndexes.size > 0) {
      if (!currentKey) {
        const nextIndex = unusedIndexes.values().next().value as number
        currentKey = component[nextIndex]!.startKey
        flushSelfLoopsAtCurrentKey()
      }

      const candidateIndexes = (adjacency.get(currentKey) ?? []).filter(
        (segmentIndex) =>
          unusedIndexes.has(segmentIndex) &&
          component[segmentIndex]!.startKey !== component[segmentIndex]!.endKey,
      )

      if (candidateIndexes.length === 0) {
        const nextUnusedIndex = Array.from(unusedIndexes).find(
          (segmentIndex) =>
            component[segmentIndex]!.startKey !== component[segmentIndex]!.endKey,
        )

        if (nextUnusedIndex === undefined) {
          flushSelfLoopsAtCurrentKey()
          break
        }

        currentKey = component[nextUnusedIndex]!.startKey
        flushSelfLoopsAtCurrentKey()
        continue
      }

      const nextSegmentIndex = this.selectNextSegmentIndex(
        candidateIndexes,
        component,
        adjacency,
        unusedIndexes,
        currentKey,
      )
      const nextSegment = component[nextSegmentIndex]!
      unusedIndexes.delete(nextSegmentIndex)

      const reverse = nextSegment.endKey === currentKey
      orderedSegments.push({
        route: nextSegment.route,
        reverse,
      })

      currentKey = reverse ? nextSegment.startKey : nextSegment.endKey
      flushSelfLoopsAtCurrentKey()
    }

    return orderedSegments
  }

  private orientMergedRouteToConnection(
    route: HighDensityIntraNodeRoute,
    start?: RoutePoint,
    end?: RoutePoint,
  ) {
    if (!start || !end || route.route.length === 0) {
      return route
    }

    const firstPoint = route.route[0]!
    const lastPoint = route.route[route.route.length - 1]!
    const shouldReverse =
      (pointsMatchXY(lastPoint, start) && !pointsMatchXY(firstPoint, start)) ||
      (pointsMatchXY(firstPoint, end) && !pointsMatchXY(lastPoint, end))

    if (!shouldReverse) {
      return route
    }

    return {
      ...route,
      route: [...route.route].reverse(),
    }
  }

  private stitchComponent(
    unsolvedRoute: UnsolvedRoute,
    component: RouteSegmentDescriptor[],
  ): HighDensityIntraNodeRoute | null {
    const orderedSegments = this.orderComponentRoutes(component, unsolvedRoute.start)

    if (orderedSegments.length === 0) {
      return null
    }

    const mergedRoutePoints: RoutePoint[] = []
    const mergedVias: Array<{ x: number; y: number }> = []
    const mergedJumpers: NonNullable<HighDensityIntraNodeRoute["jumpers"]> = []

    for (const orderedSegment of orderedSegments) {
      const segmentPoints = orderedSegment.reverse
        ? [...orderedSegment.route.route].reverse()
        : orderedSegment.route.route

      if (segmentPoints.length === 0) continue

      if (mergedRoutePoints.length === 0) {
        mergedRoutePoints.push(...segmentPoints)
      } else {
        const lastMergedPoint = mergedRoutePoints[mergedRoutePoints.length - 1]!
        const [firstSegmentPoint, ...remainingSegmentPoints] = segmentPoints
        mergedRoutePoints.push(
          ...(pointsMatch(lastMergedPoint, firstSegmentPoint)
            ? remainingSegmentPoints
            : segmentPoints),
        )
      }

      mergedVias.push(...orderedSegment.route.vias)
      if (orderedSegment.route.jumpers) {
        mergedJumpers.push(...orderedSegment.route.jumpers)
      }
    }

    return this.orientMergedRouteToConnection(
      {
        connectionName: unsolvedRoute.connectionName,
        rootConnectionName:
          orderedSegments[0]?.route.rootConnectionName ??
          component[0]?.route.rootConnectionName,
        traceThickness:
          orderedSegments[0]?.route.traceThickness ?? this.defaultTraceThickness,
        viaDiameter:
          orderedSegments[0]?.route.viaDiameter ?? this.defaultViaDiameter,
        route: mergedRoutePoints,
        vias: mergedVias,
        jumpers: mergedJumpers,
      },
      unsolvedRoute.start,
      unsolvedRoute.end,
    )
  }

  private stitchRouteGroup(
    unsolvedRoute: UnsolvedRoute,
  ): HighDensityIntraNodeRoute[] {
    if (unsolvedRoute.hdRoutes.length === 0) {
      const directRoute = this.createDirectRoute(unsolvedRoute)
      return directRoute ? [directRoute] : []
    }

    const segments = this.createSegmentDescriptors(unsolvedRoute.hdRoutes)
    if (segments.length === 0) {
      return []
    }

    return this.getConnectedComponents(segments)
      .map((component) => this.stitchComponent(unsolvedRoute, component))
      .filter((route): route is HighDensityIntraNodeRoute => Boolean(route))
  }

  _step() {
    const unsolvedRoute = this.unsolvedRoutes.pop()

    if (!unsolvedRoute) {
      this.solved = true
      return
    }

    this.mergedHdRoutes.push(...this.stitchRouteGroup(unsolvedRoute))
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Multiple High Density Route Stitch Solver",
    }

    for (const [i, mergedRoute] of this.mergedHdRoutes.entries()) {
      const solvedColor =
        this.colorMap[mergedRoute.connectionName] ??
        `hsl(120, 100%, ${40 + ((i * 10) % 40)}%)`

      for (let j = 0; j < mergedRoute.route.length - 1; j++) {
        const p1 = mergedRoute.route[j]!
        const p2 = mergedRoute.route[j + 1]!
        const segmentColor =
          p1.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor

        graphics.lines?.push({
          points: [
            { x: p1.x, y: p1.y },
            { x: p2.x, y: p2.y },
          ],
          strokeColor: segmentColor,
          strokeWidth: mergedRoute.traceThickness,
        })
      }

      for (const point of mergedRoute.route) {
        const pointColor =
          point.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: pointColor,
        })
      }

      for (const via of mergedRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: mergedRoute.viaDiameter / 2,
          fill: solvedColor,
        })
      }

      if (mergedRoute.jumpers && mergedRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(mergedRoute.jumpers, {
          color: solvedColor,
          label: mergedRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    for (const unsolvedRoute of this.unsolvedRoutes) {
      const routeColor = this.colorMap[unsolvedRoute.connectionName] ?? "gray"

      if (unsolvedRoute.start) {
        graphics.points?.push({
          x: unsolvedRoute.start.x,
          y: unsolvedRoute.start.y,
          color: routeColor,
          label: `${unsolvedRoute.connectionName} Start (z=${unsolvedRoute.start.z})`,
        })
      }
      if (unsolvedRoute.end) {
        graphics.points?.push({
          x: unsolvedRoute.end.x,
          y: unsolvedRoute.end.y,
          color: routeColor,
          label: `${unsolvedRoute.connectionName} End (z=${unsolvedRoute.end.z})`,
        })
      }

      if (unsolvedRoute.start && unsolvedRoute.end) {
        graphics.lines?.push({
          points: [
            { x: unsolvedRoute.start.x, y: unsolvedRoute.start.y },
            { x: unsolvedRoute.end.x, y: unsolvedRoute.end.y },
          ],
          strokeColor: routeColor,
          strokeDash: "2 2",
        })
      }

      for (const hdRoute of unsolvedRoute.hdRoutes) {
        if (hdRoute.route.length > 1) {
          graphics.lines?.push({
            points: hdRoute.route.map((point) => ({ x: point.x, y: point.y })),
            strokeColor: safeTransparentize(routeColor, 0.5),
            strokeDash: "10 5",
          })
        }

        for (const via of hdRoute.vias) {
          graphics.circles?.push({
            center: { x: via.x, y: via.y },
            radius: hdRoute.viaDiameter / 2,
            fill: routeColor,
          })
        }

        if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
          const jumperGraphics = getJumpersGraphics(hdRoute.jumpers, {
            color: routeColor,
            label: hdRoute.connectionName,
          })
          graphics.rects!.push(...(jumperGraphics.rects ?? []))
          graphics.lines!.push(...(jumperGraphics.lines ?? []))
        }
      }
    }

    return graphics
  }
}
