import { Rect, Line, Circle, Point } from "graphics-debug"
import { SimpleRouteJson } from "lib/types"
import {
  getConnectionPointLayer,
  getConnectionPointLayers,
} from "lib/types/srj-types"
import { getColorMap, safeTransparentize } from "lib/solvers/colors"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export const convertSrjToGraphicsObject = (srj: SimpleRouteJson) => {
  const lines: Line[] = []
  const circles: Circle[] = []
  const points: Point[] = []
  const rects: Rect[] = []

  const colorMap: Record<string, string> = getColorMap(srj)
  const layerCount = 2
  const viaRadius = (srj.minViaDiameter ?? 0.6) / 2

  // Add points for each connection's pointsToConnect
  if (srj.connections) {
    for (const connection of srj.connections) {
      for (const point of connection.pointsToConnect) {
        const pointLayers = getConnectionPointLayers(point)
        points.push({
          x: point.x,
          y: point.y,
          color: colorMap[connection.name]!,
          layer:
            pointLayers[0] ??
            ("z" in point
              ? mapZToLayerName(point.z as number, layerCount)
              : "top"),
          label: `${connection.name} (${pointLayers.join(",")})`,
        })
      }
    }
  }

  // Process each trace
  if (srj.traces) {
    for (const trace of srj.traces) {
      let traceWidth = srj.minTraceWidth

      for (let j = 0; j < trace.route.length - 1; j++) {
        const routePoint = trace.route[j]
        const nextRoutePoint = trace.route[j + 1]

        if (routePoint.route_type === "via") {
          // Add a circle for the via
          circles.push({
            center: { x: routePoint.x, y: routePoint.y },
            radius: viaRadius,
            fill: "blue",
            stroke: "none",
            layer: "z0,1",
          })
        } else if (
          routePoint.route_type === "wire" &&
          nextRoutePoint.route_type === "wire" &&
          nextRoutePoint.layer === routePoint.layer
        ) {
          traceWidth = routePoint.width
          // Create a line between consecutive wire segments on the same layer
          lines.push({
            points: [
              { x: routePoint.x, y: routePoint.y },
              { x: nextRoutePoint.x, y: nextRoutePoint.y },
            ],
            layer: `z${mapLayerNameToZ(routePoint.layer, layerCount)}`,
            strokeWidth: traceWidth,
            strokeColor: safeTransparentize(
              {
                top: "red",
                bottom: "blue",
                inner1: "green",
                inner2: "yellow",
              }[routePoint.layer]!,
              0.5,
            ),
            // For some reason this is too small, likely a graphics-debug bug
            // strokeWidth: 0.15,
          })
        } else if (routePoint.route_type === "jumper") {
          // Render jumper as a rectangle with a line connecting start and end
          const jumperStart = (routePoint as any).start as { x: number; y: number }
          const jumperEnd = (routePoint as any).end as { x: number; y: number }

          // Calculate jumper dimensions (0603 is about 1.6mm x 0.8mm)
          const footprint = (routePoint as any).footprint || "0603"
          const jumperLength =
            Math.sqrt(
              (jumperEnd.x - jumperStart.x) ** 2 +
                (jumperEnd.y - jumperStart.y) ** 2,
            ) || (footprint === "0603" ? 1.6 : 3.2)
          const jumperWidth = footprint === "0603" ? 0.8 : 1.6

          // Add jumper body as a rectangle
          const centerX = (jumperStart.x + jumperEnd.x) / 2
          const centerY = (jumperStart.y + jumperEnd.y) / 2
          rects.push({
            center: { x: centerX, y: centerY },
            width: jumperLength,
            height: jumperWidth,
            fill: "rgba(128, 0, 128, 0.5)",
            stroke: "purple",
            label: "jumper",
          })

          // Add line showing jumper connection
          lines.push({
            points: [jumperStart, jumperEnd],
            strokeColor: "purple",
            strokeWidth: jumperWidth * 0.5,
          })
        }
      }
    }
  }

  // Add obstacle rects
  for (const o of srj.obstacles) {
    rects.push({
      center: o.center,
      width: o.width,
      height: o.height,
      fill: "rgba(255,0,0,0.5)",
      layer: `z${o.layers.map(mapLayerNameToZ).join(",")}`,
    } as Rect)
  }

  return {
    rects,
    circles,
    lines,
    points,
  }
}
