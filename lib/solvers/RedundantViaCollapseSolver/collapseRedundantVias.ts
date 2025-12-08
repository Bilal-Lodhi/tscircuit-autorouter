import { SimplifiedPcbTrace } from "lib/types"

type SimplifiedRouteSegment = SimplifiedPcbTrace["route"][number]

type ViaSegment = Extract<SimplifiedRouteSegment, { route_type: "via" }>

type WireSegment = Extract<SimplifiedRouteSegment, { route_type: "wire" }>

export function collapseRedundantVias(
  route: SimplifiedRouteSegment[],
  allowedLayers: string[],
): SimplifiedRouteSegment[] {
  if (allowedLayers.length === 0) return route

  const viaIndices = route
    .map((segment, idx) => (segment.route_type === "via" ? idx : -1))
    .filter((idx) => idx >= 0)

  if (viaIndices.length < 2) return route

  const firstVia = route[viaIndices[0]] as ViaSegment
  const lastVia = route[viaIndices[viaIndices.length - 1]] as ViaSegment

  if (firstVia.to_layer !== lastVia.from_layer) return route
  if (!allowedLayers.includes(firstVia.to_layer)) return route

  const middleLayers = new Set(
    route
      .slice(viaIndices[0] + 1, viaIndices[viaIndices.length - 1])
      .filter((segment) => segment.route_type === "wire")
      .map((segment) => (segment as WireSegment).layer),
  )

  if (middleLayers.size !== 1 || !middleLayers.has(firstVia.to_layer)) {
    return route
  }

  return route
    .filter((segment) => segment.route_type === "wire")
    .map((segment) =>
      segment.route_type === "wire"
        ? { ...segment, layer: firstVia.to_layer }
        : segment,
    )
}
