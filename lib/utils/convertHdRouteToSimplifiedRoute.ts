import { SimplifiedPcbTraces } from "lib/types"
import { HighDensityIntraNodeRoute, Jumper } from "lib/types/high-density-types"
import { mapZToLayerName } from "./mapZToLayerName"

type Point = { x: number; y: number; z: number }

const POINT_EPSILON = 1e-3
const MICRO_DETOUR_MAX_CHORD = 0.06
const MICRO_DETOUR_MIN_TINY_EDGE = 0.01
const MICRO_DETOUR_MIN_LARGE_EDGE = 0.03
const MICRO_DETOUR_MAX_PERPENDICULAR = 0.01

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const sanitizeLayerPoints = (points: Point[]) => {
  if (points.length < 2) return points

  const cleaned = [...points]
  let changed = true

  while (changed) {
    changed = false

    for (let i = 1; i < cleaned.length; i++) {
      if (distance(cleaned[i - 1], cleaned[i]) < POINT_EPSILON) {
        cleaned.splice(i, 1)
        changed = true
        break
      }
    }
    if (changed) continue

    for (let i = 1; i < cleaned.length - 1; i++) {
      const a = cleaned[i - 1]
      const b = cleaned[i]
      const c = cleaned[i + 1]

      const chord = distance(a, c)
      if (chord >= MICRO_DETOUR_MAX_CHORD) continue

      const distAB = distance(a, b)
      const distBC = distance(b, c)
      if (Math.min(distAB, distBC) >= MICRO_DETOUR_MIN_TINY_EDGE) continue
      if (Math.max(distAB, distBC) <= MICRO_DETOUR_MIN_LARGE_EDGE) continue

      const doubledArea = Math.abs(
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      )
      const perpendicularDistance = doubledArea / Math.max(chord, 1e-9)
      if (perpendicularDistance >= MICRO_DETOUR_MAX_PERPENDICULAR) continue

      cleaned.splice(i, 1)
      changed = true
      break
    }
  }

  return cleaned
}

/**
 * Extended HD route type that may contain jumpers (from HighDensitySolver)
 */
type HdRouteWithOptionalJumpers = HighDensityIntraNodeRoute & {
  jumpers?: Jumper[]
}

export const convertHdRouteToSimplifiedRoute = (
  hdRoute: HdRouteWithOptionalJumpers,
  layerCount: number,
): SimplifiedPcbTraces[number]["route"] => {
  const result: SimplifiedPcbTraces[number]["route"] = []
  if (hdRoute.route.length === 0) return result

  let currentLayerPoints: Point[] = []
  let currentZ = hdRoute.route[0].z

  // Add all points to their respective layer segments
  for (let i = 0; i < hdRoute.route.length; i++) {
    const point = hdRoute.route[i]

    // If we're changing layers, process the current layer's points
    // and add a via if one exists at this position
    if (point.z !== currentZ) {
      // Add all wire segments for the current layer
      const layerName = mapZToLayerName(currentZ, layerCount)
      for (const layerPoint of sanitizeLayerPoints(currentLayerPoints)) {
        result.push({
          route_type: "wire",
          x: layerPoint.x,
          y: layerPoint.y,
          width: hdRoute.traceThickness,
          layer: layerName,
        })
      }

      // Check if a via exists at this position
      const viaExists = hdRoute.vias.some(
        (via) =>
          Math.abs(via.x - point.x) < 0.001 &&
          Math.abs(via.y - point.y) < 0.001,
      )

      // Add a via if one exists
      if (viaExists) {
        const fromLayer = mapZToLayerName(currentZ, layerCount)
        const toLayer = mapZToLayerName(point.z, layerCount)

        result.push({
          route_type: "via",
          x: point.x,
          y: point.y,
          from_layer: fromLayer,
          to_layer: toLayer,
        })
      }

      // Start a new layer
      currentLayerPoints = [point]
      currentZ = point.z
    } else {
      // Continue on the same layer
      currentLayerPoints.push(point)
    }
  }

  // Add the final layer's wire segments
  const layerName = mapZToLayerName(currentZ, layerCount)
  for (const layerPoint of sanitizeLayerPoints(currentLayerPoints)) {
    result.push({
      route_type: "wire",
      x: layerPoint.x,
      y: layerPoint.y,
      width: hdRoute.traceThickness,
      layer: layerName,
    })
  }

  // Add jumpers if present
  if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
    const jumperLayerName = mapZToLayerName(
      hdRoute.route[0]?.z ?? 0,
      layerCount,
    )
    for (const jumper of hdRoute.jumpers) {
      result.push({
        route_type: "jumper",
        start: jumper.start,
        end: jumper.end,
        footprint: jumper.footprint,
        layer: jumperLayerName,
      })
    }
  }

  return result
}
