import type { SerializedGraphPort } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import type { SerializedHyperGraphWithSolvedRoutes } from "./extractSectionOfHyperGraph"

export interface VisualizeSerializedHyperGraphOptions {
  title?: string
  highlightSolvedRoutePorts?: boolean
  portRadius?: number
  lineWidth?: number
  sectionPortColor?: string
  routePortColor?: string
  routeColorMap?: Record<string, string>
}

function getPortCenter(port: SerializedGraphPort): { x: number; y: number } {
  return {
    x: port.d.x,
    y: port.d.y,
  }
}

export function visualizeSerializedHyperGraph(
  hyperGraph: SerializedHyperGraphWithSolvedRoutes,
  options: VisualizeSerializedHyperGraphOptions = {},
): GraphicsObject {
  const portById = new Map(hyperGraph.ports.map((port) => [port.portId, port]))
  const solvedRoutePortIds = new Set(
    hyperGraph.solvedRoutes?.flatMap((solvedRoute) => solvedRoute.pathPortIds) ??
      [],
  )
  const titleMargin = 0.45
  const minX = Math.min(
    ...hyperGraph.regions.map((region) => region.d.center.x - region.d.width / 2),
  )
  const minY = Math.min(
    ...hyperGraph.regions.map((region) => region.d.center.y - region.d.height / 2),
  )

  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: hyperGraph.regions.map((region) => ({
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      fill: "rgba(255, 255, 255, 0)",
      stroke: "#58a9ff",
    })),
    circles: hyperGraph.ports.map((port) => {
      const isSolvedRoutePort =
        options.highlightSolvedRoutePorts && solvedRoutePortIds.has(port.portId)

      return {
        center: getPortCenter(port),
        radius: isSolvedRoutePort
          ? (options.portRadius ?? 0.08) * 1.1
          : options.portRadius ?? 0.08,
        fill: isSolvedRoutePort
          ? options.routePortColor ?? "rgba(255, 212, 212, 1)"
          : options.sectionPortColor ?? "rgba(161, 213, 255, 1)",
        stroke: isSolvedRoutePort ? "#ff3d3d" : "#2d8fff",
      }
    }),
    lines: [],
    texts: options.title
      ? [
          {
            x: minX,
            y: minY - titleMargin,
            text: options.title,
            color: "#2f9c38",
            fontSize: 0.28,
            anchorSide: "top_left",
          },
        ]
      : undefined,
  }

  for (const solvedRoute of hyperGraph.solvedRoutes ?? []) {
    const routePoints = solvedRoute.pathPortIds
      .map((pathPortId) => portById.get(pathPortId))
      .filter((port): port is SerializedGraphPort => port !== undefined)
      .map(getPortCenter)

    if (routePoints.length < 2) continue

    graphics.lines!.push({
      points: routePoints,
      strokeColor:
        options.routeColorMap?.[solvedRoute.connectionId] ?? "#ff3d3d",
      strokeWidth: options.lineWidth ?? 0.03,
    })
  }

  return graphics
}
