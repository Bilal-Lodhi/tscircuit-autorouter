export type TraceId = string
export type NetId = string
export type PointId = string
export type OffBoardConnectionId = string
export type ConnectionPoint = {
  x: number
  y: number
  layer: string
  pointId?: PointId
  pcb_port_id?: string
}
export type MultiLayerConnectionPoint = {
  x: number
  y: number
  layers: string[]
  pointId?: PointId
  pcb_port_id?: string
}

export interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  minViaDiameter?: number
  obstacles: Obstacle[]
  connections: Array<SimpleRouteConnection>
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  outline?: Array<{ x: number; y: number }>
  traces?: SimplifiedPcbTraces
}

export interface Obstacle {
  type: "rect"
  layers: string[]
  zLayers?: number[]
  center: { x: number; y: number }
  width: number
  height: number
  connectedTo: Array<TraceId | NetId>
  netIsAssignable?: boolean
  offBoardConnectsTo?: Array<OffBoardConnectionId>
}

export interface SimpleRouteConnection {
  name: string
  isOffBoard?: boolean
  netConnectionName?: string
  nominalTraceWidth?: number
  pointsToConnect: Array<ConnectionPoint | MultiLayerConnectionPoint>

  /** @deprecated DO NOT USE **/
  externallyConnectedPointIds?: PointId[][]
}

export interface SimplifiedPcbTrace {
  type: "pcb_trace"
  pcb_trace_id: TraceId
  connection_name: string
  route: Array<
    | {
        route_type: "wire"
        x: number
        y: number
        width: number
        layer: string
      }
    | {
        route_type: "via"
        x: number
        y: number
        to_layer: string
        from_layer: string
      }
  >
}

export type SimplifiedPcbTraces = Array<SimplifiedPcbTrace>

// Type guards and helpers for ConnectionPoint types
export function isMultiLayerConnectionPoint(
  point: ConnectionPoint | MultiLayerConnectionPoint,
): point is MultiLayerConnectionPoint {
  return "layers" in point && Array.isArray((point as any).layers)
}

export function isSingleLayerConnectionPoint(
  point: ConnectionPoint | MultiLayerConnectionPoint,
): point is ConnectionPoint {
  return "layer" in point && typeof (point as any).layer === "string"
}

/**
 * Gets the primary layer from a connection point.
 * For MultiLayerConnectionPoint, returns the first layer as default.
 */
export function getConnectionPointLayer(
  point: ConnectionPoint | MultiLayerConnectionPoint,
): string {
  if (isMultiLayerConnectionPoint(point)) {
    return point.layers[0]
  }
  return point.layer
}

/**
 * Gets all layers from a connection point.
 * For ConnectionPoint, returns an array with the single layer.
 */
export function getConnectionPointLayers(
  point: ConnectionPoint | MultiLayerConnectionPoint,
): string[] {
  if (isMultiLayerConnectionPoint(point)) {
    return point.layers
  }
  return [point.layer]
}
