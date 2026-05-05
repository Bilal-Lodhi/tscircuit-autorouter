import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

export type RerouteRectRegion = {
  shape: "rect"
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>
type ThroughObstacleRoutePoint = Extract<
  RoutePoint,
  { route_type: "through_obstacle" }
>
type LocatableRoutePoint = {
  route_type: RoutePoint["route_type"]
  x: number
  y: number
  layer?: string
  from_layer?: string
  to_layer?: string
  width?: number
}

type LocatedPoint = {
  x: number
  y: number
  layer: string
  width: number
}

const EPSILON = 1e-9
const CONNECTION_POINT_NUDGE_DISTANCE = 0.01

const isWireRoutePoint = (point: RoutePoint): point is WireRoutePoint =>
  point.route_type === "wire"

const isViaRoutePoint = (point: RoutePoint): point is ViaRoutePoint =>
  point.route_type === "via"

const isThroughObstacleRoutePoint = (
  point: RoutePoint,
): point is ThroughObstacleRoutePoint => point.route_type === "through_obstacle"

const getRoutePointLocation = (
  point: RoutePoint,
): LocatableRoutePoint | null => {
  if (isWireRoutePoint(point) || isViaRoutePoint(point)) return point
  if (
    isThroughObstacleRoutePoint(point) &&
    Math.hypot(point.end.x - point.start.x, point.end.y - point.start.y) <=
      EPSILON
  ) {
    return {
      route_type: point.route_type,
      x: point.start.x,
      y: point.start.y,
      from_layer: point.from_layer,
      to_layer: point.to_layer,
      width: point.width,
    }
  }
  return null
}

const getSegmentLayer = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
) =>
  start.layer ??
  end.layer ??
  start.to_layer ??
  end.from_layer ??
  start.from_layer ??
  end.to_layer ??
  "top"

const getSegmentWidth = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  fallbackWidth: number,
) => {
  return start.width ?? end.width ?? fallbackWidth
}

const getInterpolatedPoint = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  t: number,
  layer: string,
  width: number,
): LocatedPoint => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
  layer,
  width,
})

const getPointOutsideClippedInterval = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  boundaryT: number,
  direction: -1 | 1,
  layer: string,
  width: number,
) => {
  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
  if (segmentLength <= EPSILON) {
    return getInterpolatedPoint(start, end, boundaryT, layer, width)
  }

  const nudgeT = CONNECTION_POINT_NUDGE_DISTANCE / segmentLength
  return getInterpolatedPoint(
    start,
    end,
    Math.max(0, Math.min(1, boundaryT + direction * nudgeT)),
    layer,
    width,
  )
}

const locatedPointToConnectionPoint = ({
  x,
  y,
  layer,
}: LocatedPoint): ConnectionPoint => ({
  x,
  y,
  layer,
})

const locatedPointToWireRoutePoint = ({
  x,
  y,
  layer,
  width,
}: LocatedPoint): WireRoutePoint => ({
  route_type: "wire",
  x,
  y,
  layer,
  width,
})

const getRectInsideInterval = (
  start: LocatableRoutePoint,
  end: LocatableRoutePoint,
  region: RerouteRectRegion,
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let t0 = 0
  let t1 = 1

  const clip = (p: number, q: number) => {
    if (Math.abs(p) < EPSILON) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }

  if (!clip(-dx, start.x - region.minX)) return null
  if (!clip(dx, region.maxX - start.x)) return null
  if (!clip(-dy, start.y - region.minY)) return null
  if (!clip(dy, region.maxY - start.y)) return null

  return { startT: t0, endT: t1 }
}

const distance = (a: LocatedPoint, b: LocatedPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y)

const appendClippedTraceSegment = (
  traces: SimplifiedPcbTrace[],
  trace: SimplifiedPcbTrace,
  segmentIndex: number,
  start: LocatedPoint,
  end: LocatedPoint,
) => {
  if (distance(start, end) <= EPSILON) return

  traces.push({
    type: "pcb_trace",
    pcb_trace_id: `${trace.pcb_trace_id}_keep_${segmentIndex}`,
    connection_name: trace.connection_name,
    route: [
      locatedPointToWireRoutePoint(start),
      locatedPointToWireRoutePoint(end),
    ],
  })
}

const createRerouteConnection = ({
  trace,
  ripIndex,
  start,
  end,
}: {
  trace: SimplifiedPcbTrace
  ripIndex: number
  start: LocatedPoint
  end: LocatedPoint
}): SimpleRouteConnection => ({
  name: `${trace.connection_name}_reroute_${trace.pcb_trace_id}_${ripIndex}`,
  rootConnectionName: trace.connection_name,
  pointsToConnect: [
    locatedPointToConnectionPoint(start),
    locatedPointToConnectionPoint(end),
  ],
})

const getClippedTracePieces = (
  trace: SimplifiedPcbTrace,
  region: RerouteRectRegion,
  fallbackWidth: number,
) => {
  const keptTraces: SimplifiedPcbTrace[] = []
  const rerouteConnections: SimpleRouteConnection[] = []
  let activeRipStart: LocatedPoint | null = null
  let keptSegmentIndex = 0

  for (let i = 0; i < trace.route.length - 1; i++) {
    const start = getRoutePointLocation(trace.route[i]!)
    const end = getRoutePointLocation(trace.route[i + 1]!)

    if (!start || !end) {
      return null
    }

    const layer = getSegmentLayer(start, end)
    const width = getSegmentWidth(start, end, fallbackWidth)
    const interval = getRectInsideInterval(start, end, region)
    const segmentStart = getInterpolatedPoint(start, end, 0, layer, width)
    const segmentEnd = getInterpolatedPoint(start, end, 1, layer, width)

    if (!interval) {
      appendClippedTraceSegment(
        keptTraces,
        trace,
        keptSegmentIndex++,
        segmentStart,
        segmentEnd,
      )
      continue
    }

    if (interval.startT > EPSILON) {
      appendClippedTraceSegment(
        keptTraces,
        trace,
        keptSegmentIndex++,
        segmentStart,
        getInterpolatedPoint(start, end, interval.startT, layer, width),
      )
    }

    const rippedEnd = getInterpolatedPoint(
      start,
      end,
      interval.endT,
      layer,
      width,
    )
    const rerouteStart = getPointOutsideClippedInterval(
      start,
      end,
      interval.startT,
      -1,
      layer,
      width,
    )
    const rerouteEnd = getPointOutsideClippedInterval(
      start,
      end,
      interval.endT,
      1,
      layer,
      width,
    )

    if (!activeRipStart) {
      activeRipStart = rerouteStart
    }

    if (interval.endT < 1 - EPSILON) {
      rerouteConnections.push(
        createRerouteConnection({
          trace,
          ripIndex: rerouteConnections.length,
          start: activeRipStart,
          end: rerouteEnd,
        }),
      )
      activeRipStart = null
      appendClippedTraceSegment(
        keptTraces,
        trace,
        keptSegmentIndex++,
        rippedEnd,
        segmentEnd,
      )
    }
  }

  if (activeRipStart) {
    const finalPoint = trace.route
      .slice()
      .reverse()
      .map(getRoutePointLocation)
      .find((point): point is LocatableRoutePoint => Boolean(point))

    if (finalPoint) {
      rerouteConnections.push(
        createRerouteConnection({
          trace,
          ripIndex: rerouteConnections.length,
          start: activeRipStart,
          end: {
            x: finalPoint.x,
            y: finalPoint.y,
            layer:
              finalPoint.layer ?? finalPoint.from_layer ?? activeRipStart.layer,
            width: activeRipStart.width,
          },
        }),
      )
    }
  }

  return { keptTraces, rerouteConnections }
}

export const getRerouteSimpleRouteJson = (
  simpleRouteJson: SimpleRouteJson,
  region: RerouteRectRegion,
): SimpleRouteJson => {
  const nextSrj = structuredClone(simpleRouteJson)
  const nextTraces: SimplifiedPcbTrace[] = []
  const rerouteConnections: SimpleRouteConnection[] = []

  for (const trace of simpleRouteJson.traces ?? []) {
    const clippedPieces = getClippedTracePieces(
      trace,
      region,
      simpleRouteJson.minTraceWidth,
    )

    if (!clippedPieces || clippedPieces.rerouteConnections.length === 0) {
      nextTraces.push(structuredClone(trace))
      continue
    }

    nextTraces.push(...clippedPieces.keptTraces)
    rerouteConnections.push(...clippedPieces.rerouteConnections)
  }

  return {
    ...nextSrj,
    traces: nextTraces,
    connections: rerouteConnections,
  }
}

export const reconnectReroutedSimpleRouteJsonRegion = (
  originalSrj: SimpleRouteJson,
  reroutedSrj: SimpleRouteJson,
): SimpleRouteJson => {
  const rerouteConnectionToRoot = new Map(
    reroutedSrj.connections.map((connection) => [
      connection.name,
      connection.rootConnectionName ?? connection.name,
    ]),
  )

  const traces = (reroutedSrj.traces ?? []).map((trace) => {
    const rootConnectionName = rerouteConnectionToRoot.get(
      trace.connection_name,
    )
    if (!rootConnectionName) return structuredClone(trace)

    return {
      ...structuredClone(trace),
      connection_name: rootConnectionName,
    }
  })

  return {
    ...structuredClone(originalSrj),
    traces,
    jumpers: reroutedSrj.jumpers
      ? structuredClone(reroutedSrj.jumpers)
      : structuredClone(originalSrj.jumpers),
  }
}
