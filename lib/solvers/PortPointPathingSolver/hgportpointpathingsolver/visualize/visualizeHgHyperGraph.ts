import type { GraphicsObject } from "graphics-debug"
import type { HyperGraphHg, RegionPortHg } from "../types"

/** Draws regions and ports from the HG hypergraph for debugging. */
export function visualizeHgHyperGraph(graph: HyperGraphHg): GraphicsObject {
  const graphics: GraphicsObject = {
    rects: [],
    points: [],
  }

  for (const region of graph.regions) {
    const center = region.d.center
    const bounds = (
      region.d as {
        bounds?: { minX: number; maxX: number; minY: number; maxY: number }
      }
    ).bounds
    const widthFromBounds =
      bounds && Number.isFinite(bounds.maxX - bounds.minX)
        ? bounds.maxX - bounds.minX
        : undefined
    const heightFromBounds =
      bounds && Number.isFinite(bounds.maxY - bounds.minY)
        ? bounds.maxY - bounds.minY
        : undefined
    const width =
      Number.isFinite(region.d.width) && region.d.width > 0
        ? region.d.width
        : widthFromBounds
    const height =
      Number.isFinite(region.d.height) && region.d.height > 0
        ? region.d.height
        : heightFromBounds
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      continue
    }
    if (!width || !height) {
      continue
    }
    graphics.rects!.push({
      center,
      width,
      height,
      fill: "rgba(200, 200, 200, 0.5)",
      label: region.regionId,
    })
  }

  for (const port of graph.ports) {
    graphics.points!.push({
      x: port.d.x,
      y: port.d.y,
      color: "rgba(4, 90, 20, 0.3)",
      label: port.portId,
    })
  }

  return graphics
}
