import { SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export const getConnectivityMapFromSimpleRouteJson = (srj: SimpleRouteJson) => {
  const connMap = new ConnectivityMap({})
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if ("pcb_port_id" in point && point.pcb_port_id) {
        connMap.addConnections([[connection.name, point.pcb_port_id as string]])
      }
    }
  }
  for (const obstacle of srj.obstacles) {
    const offBoardConnections = obstacle.offBoardConnectsTo ?? []
    const connectionGroup = Array.from(
      new Set([...obstacle.connectedTo, ...offBoardConnections]),
    )

    if (connectionGroup.length > 0) {
      connMap.addConnections([connectionGroup])
    }
  }
  return connMap
}
