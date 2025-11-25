import { BaseSolver } from "../BaseSolver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ViaReference = { routeIdx: number; viaIdx: number }

type ViaCluster = {
  sumX: number
  sumY: number
  count: number
  references: ViaReference[]
}

type SameNetViaMergerOptions = {
  hdRoutes: HighDensityRoute[]
  connections: SimpleRouteConnection[]
}

export class SameNetViaMerger extends BaseSolver {
  mergedHdRoutes: HighDensityRoute[]
  private connectionToNetName: Map<string, string>
  private tolerance = 1e-4

  constructor(options: SameNetViaMergerOptions) {
    super()
    this.mergedHdRoutes = options.hdRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))

    this.connectionToNetName = new Map(
      options.connections.map((connection) => [
        connection.name,
        connection.netConnectionName ?? connection.name,
      ]),
    )
  }

  private normalizeConnectionName(connectionName: string) {
    const match = connectionName.match(/^(.+?)_mst\d+$/)
    return match ? match[1] : connectionName
  }

  private getNetName(connectionName: string) {
    const normalized = this.normalizeConnectionName(connectionName)
    return (
      this.connectionToNetName.get(normalized) ??
      this.connectionToNetName.get(connectionName) ??
      normalized
    )
  }

  private findOrCreateCluster(clusters: ViaCluster[], x: number, y: number) {
    for (const cluster of clusters) {
      const centerX = cluster.sumX / cluster.count
      const centerY = cluster.sumY / cluster.count
      const dx = centerX - x
      const dy = centerY - y
      if (dx * dx + dy * dy <= this.tolerance * this.tolerance) return cluster
    }

    const newCluster: ViaCluster = {
      sumX: 0,
      sumY: 0,
      count: 0,
      references: [],
    }
    clusters.push(newCluster)
    return newCluster
  }

  private adjustRoutePoints(
    route: HighDensityRoute,
    canonicalX: number,
    canonicalY: number,
  ) {
    for (const point of route.route) {
      const dx = point.x - canonicalX
      const dy = point.y - canonicalY
      if (dx * dx + dy * dy <= this.tolerance * this.tolerance) {
        point.x = canonicalX
        point.y = canonicalY
      }
    }
  }

  _step() {
    const clustersByNet = new Map<string, ViaCluster[]>()

    this.mergedHdRoutes.forEach((route, routeIdx) => {
      const netName = this.getNetName(route.connectionName)
      const clusters = clustersByNet.get(netName) ?? []
      clustersByNet.set(netName, clusters)

      route.vias.forEach((via, viaIdx) => {
        const cluster = this.findOrCreateCluster(clusters, via.x, via.y)
        cluster.sumX += via.x
        cluster.sumY += via.y
        cluster.count += 1
        cluster.references.push({ routeIdx, viaIdx })
      })
    })

    const canonicalByRoute = new Map<number, Array<{ x: number; y: number }>>()

    for (const clusters of clustersByNet.values()) {
      for (const cluster of clusters) {
        if (cluster.count === 0) continue
        const canonicalX = cluster.sumX / cluster.count
        const canonicalY = cluster.sumY / cluster.count

        for (const ref of cluster.references) {
          const route = this.mergedHdRoutes[ref.routeIdx]
          route.vias[ref.viaIdx].x = canonicalX
          route.vias[ref.viaIdx].y = canonicalY

          const list = canonicalByRoute.get(ref.routeIdx) ?? []
          canonicalByRoute.set(ref.routeIdx, list)
          list.push({ x: canonicalX, y: canonicalY })
        }
      }
    }

    for (const [routeIdx, canonicalPositions] of canonicalByRoute.entries()) {
      const route = this.mergedHdRoutes[routeIdx]
      for (const position of canonicalPositions) {
        this.adjustRoutePoints(route, position.x, position.y)
      }
    }

    this.solved = true
  }
}
