import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import {
  CollapseRedundantViasResult,
  collapseRedundantVias,
} from "./collapseRedundantVias"

export interface RedundantViaCollapseSolverInput {
  hdRoutes: HighDensityRoute[]
  connections: SimpleRouteJson["connections"]
  layerCount: number
}

export class RedundantViaCollapseSolver extends BaseSolver {
  collapsedRoutesByConnection: Map<string, SimplifiedPcbTrace["route"][]>
  collapseSummaries: Array<
    CollapseRedundantViasResult & {
      connectionName: string
      beforeRoute: SimplifiedPcbTrace["route"]
    }
  >

  constructor(private input: RedundantViaCollapseSolverInput) {
    super()
    this.MAX_ITERATIONS = 1
    this.collapsedRoutesByConnection = new Map()
    this.collapseSummaries = []
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

      const collapsedResult = collapseRedundantVias(
        simplifiedRoute,
        allowedLayers,
      )

      this.collapseSummaries.push({
        connectionName: route.connectionName,
        beforeRoute: simplifiedRoute,
        ...collapsedResult,
      })

      const list = this.collapsedRoutesByConnection.get(route.connectionName)
      if (list) list.push(collapsedResult.route)
      else
        this.collapsedRoutesByConnection.set(route.connectionName, [
          collapsedResult.route,
        ])
    }

    this.solved = true
  }

  getCollapsedRoutesByConnection() {
    return this.collapsedRoutesByConnection
  }

  visualize() {
    const graphics: Required<GraphicsObject> & {
      coordinateSystem: string
      title: string
    } = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      arrows: [],
      texts: [],
      title: "Redundant Via Collapse",
      coordinateSystem: "cartesian",
    }

    const addWireLines = (
      route: SimplifiedPcbTrace["route"],
      strokeColor: string,
      labelPrefix: string,
    ) => {
      for (let i = 1; i < route.length; i++) {
        const prev = route[i - 1]
        const curr = route[i]
        if (
          prev.route_type === "wire" &&
          curr.route_type === "wire" &&
          prev.layer === curr.layer
        ) {
          graphics.lines.push({
            points: [
              { x: prev.x, y: prev.y },
              { x: curr.x, y: curr.y },
            ],
            strokeColor,
            strokeWidth: curr.width,
            label: `${labelPrefix} (layer ${curr.layer})`,
          })
        }
      }
    }

    const addViaMarkers = (
      route: SimplifiedPcbTrace["route"],
      fill: string,
      labelPrefix: string,
    ) => {
      for (const segment of route) {
        if (segment.route_type === "via") {
          graphics.circles.push({
            center: { x: segment.x, y: segment.y },
            radius: 0.4,
            fill,
            label: `${labelPrefix} ${segment.from_layer}→${segment.to_layer}`,
          })
        }
      }
    }

    for (const summary of this.collapseSummaries) {
      addWireLines(
        summary.beforeRoute,
        "#9aa5b1",
        `${summary.connectionName} before`,
      )
      addViaMarkers(
        summary.beforeRoute,
        "rgba(255, 105, 97, 0.6)",
        `${summary.connectionName} before via`,
      )

      addWireLines(summary.route, "#0b74ff", `${summary.connectionName} after`)
      addViaMarkers(
        summary.route,
        "rgba(15, 157, 88, 0.55)",
        `${summary.connectionName} after via`,
      )

      if (summary.collapsedPair) {
        const {
          collapsedPair: { startVia, endVia },
          connectionName,
        } = summary
        graphics.lines.push({
          points: [
            { x: startVia.x, y: startVia.y },
            { x: endVia.x, y: endVia.y },
          ],
          strokeColor: "rgba(255, 165, 0, 0.7)",
          strokeWidth: 0.6,
          label: `${connectionName} collapsed span`,
        })
        graphics.circles.push(
          {
            center: { x: startVia.x, y: startVia.y },
            radius: 0.6,
            fill: "rgba(255, 165, 0, 0.35)",
            label: `${connectionName} collapsed start`,
          },
          {
            center: { x: endVia.x, y: endVia.y },
            radius: 0.6,
            fill: "rgba(255, 165, 0, 0.35)",
            label: `${connectionName} collapsed end`,
          },
        )
      }
    }

    return graphics
  }
}
