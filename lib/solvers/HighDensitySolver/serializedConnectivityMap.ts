import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export type SerializedConnectivityMap = Record<string, string[]>

export const serializeConnectivityMapForConnectionNames = (
  connMap: ConnectivityMap | undefined,
  connectionNames: string[],
): SerializedConnectivityMap | undefined => {
  if (!connMap) {
    return undefined
  }

  const uniqueConnectionNames = [...new Set(connectionNames)]
  const serialized: SerializedConnectivityMap = {}

  const rawIdToNetMap = (
    connMap as ConnectivityMap & {
      idToNetMap?: Record<string, string>
    }
  ).idToNetMap
  const rawNetMap = (
    connMap as ConnectivityMap & {
      netMap?: Record<string, string[]>
    }
  ).netMap

  if (rawIdToNetMap && rawNetMap) {
    const relevantNetIds = new Set<string>()
    for (const connectionName of uniqueConnectionNames) {
      const netId = rawIdToNetMap[connectionName]
      if (netId) {
        relevantNetIds.add(netId)
      }
    }

    for (const netId of relevantNetIds) {
      const connectedIds = rawNetMap[netId]
      if (!connectedIds) continue
      serialized[netId] = [...new Set(connectedIds)].sort()
    }

    return serialized
  }

  for (const connectionName of uniqueConnectionNames) {
    for (const candidateName of uniqueConnectionNames) {
      if (!connMap.areIdsConnected(connectionName, candidateName)) {
        continue
      }

      const netId =
        connMap.getNetConnectedToId(connectionName) ??
        `synthetic-net:${connectionName}`

      if (!serialized[netId]) {
        serialized[netId] = []
      }

      if (!serialized[netId].includes(connectionName)) {
        serialized[netId].push(connectionName)
      }
      if (!serialized[netId].includes(candidateName)) {
        serialized[netId].push(candidateName)
      }
    }
  }

  for (const netId of Object.keys(serialized)) {
    serialized[netId].sort()
  }

  return serialized
}

export const createConnectivityMapFromSerialized = (
  serialized: SerializedConnectivityMap | undefined,
): ConnectivityMap | undefined => {
  if (!serialized) {
    return undefined
  }

  return new ConnectivityMap(
    Object.fromEntries(
      Object.entries(serialized).map(([netId, connectedIds]) => [
        netId,
        [...new Set(connectedIds)].sort(),
      ]),
    ),
  )
}
