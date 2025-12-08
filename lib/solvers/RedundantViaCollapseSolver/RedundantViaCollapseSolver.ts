import { BaseSolver } from "../BaseSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { collapseRedundantVias } from "./collapseRedundantVias"

export interface RedundantViaCollapseSolverInput {
  hdRoutes: HighDensityRoute[]
  connections: SimpleRouteJson["connections"]
  layerCount: number
}

export class RedundantViaCollapseSolver extends BaseSolver {
  collapsedRoutesByConnection: Map<string, SimplifiedPcbTrace["route"][]>

  constructor(private input: RedundantViaCollapseSolverInput) {
    super()
    this.MAX_ITERATIONS = 1
    this.collapsedRoutesByConnection = new Map()
  }

  _step() {
    for (const route of this.input.hdRoutes) {
      const connection = this.input.connections.find(
        (conn) => conn.name === route.connectionName,
      )

      const allowedLayers = connection
        ? connection.pointsToConnect
            .map((ptc) => getConnectionPointLayers(ptc))
            .reduce<string[]>(
              (acc, layers) => acc.filter((l) => layers.includes(l)),
              getConnectionPointLayers(connection.pointsToConnect[0]!),
            )
        : []

      const simplifiedRoute = convertHdRouteToSimplifiedRoute(
        route,
        this.input.layerCount,
      )

      const collapsedRoute = collapseRedundantVias(
        simplifiedRoute,
        allowedLayers,
      )

      const list = this.collapsedRoutesByConnection.get(route.connectionName)
      if (list) list.push(collapsedRoute)
      else
        this.collapsedRoutesByConnection.set(route.connectionName, [
          collapsedRoute,
        ])
    }

    this.solved = true
  }

  getCollapsedRoutesByConnection() {
    return this.collapsedRoutesByConnection
  }
}
