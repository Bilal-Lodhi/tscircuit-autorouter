import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

export const createTrivialRoutesForSingleConnectionNode = ({
  node,
  traceWidth,
  viaDiameter,
}: {
  node: NodeWithPortPoints
  traceWidth: number
  viaDiameter: number
}): HighDensityIntraNodeRoute[] => {
  const connectionGroups = new Map<string, NodeWithPortPoints["portPoints"]>()

  for (const portPoint of node.portPoints) {
    const existing = connectionGroups.get(portPoint.connectionName)
    if (existing) {
      existing.push(portPoint)
    } else {
      connectionGroups.set(portPoint.connectionName, [portPoint])
    }
  }

  const routes: HighDensityIntraNodeRoute[] = []
  for (const [connectionName, points] of connectionGroups) {
    if (points.length < 2) continue

    const A = points[0]
    const B = points[points.length - 1]

    if (
      Math.abs(A.x - B.x) < 1e-6 &&
      Math.abs(A.y - B.y) < 1e-6 &&
      A.z === B.z
    ) {
      continue
    }

    const route: HighDensityIntraNodeRoute["route"] = []
    const vias: HighDensityIntraNodeRoute["vias"] = []

    route.push({ x: A.x, y: A.y, z: A.z })

    if (A.z !== B.z) {
      route.push({ x: B.x, y: B.y, z: A.z })
      route.push({ x: B.x, y: B.y, z: B.z })
      vias.push({ x: B.x, y: B.y })
    }

    route.push({ x: B.x, y: B.y, z: B.z })

    const dedupedRoute = route.filter(
      (pt, idx, arr) =>
        idx === 0 ||
        Math.abs(pt.x - arr[idx - 1].x) > 1e-6 ||
        Math.abs(pt.y - arr[idx - 1].y) > 1e-6 ||
        pt.z !== arr[idx - 1].z,
    )

    routes.push({
      connectionName,
      rootConnectionName: points[0].rootConnectionName,
      traceThickness: traceWidth,
      viaDiameter,
      route: dedupedRoute,
      vias,
    })
  }

  return routes
}
