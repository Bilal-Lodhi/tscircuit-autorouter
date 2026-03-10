import type {
  ConnectionHg,
  HyperGraphHg,
  RawPort,
  RegionId,
  SolvedRoutesHg,
} from "./types"

type SerializedRegionPortAssignment = {
  regionPort1Id: string
  regionPort2Id: string
  connectionId: string
}

type SerializedGraphPort = {
  portId: string
  region1Id: RegionId
  region2Id: RegionId
  d: Omit<RawPort, "regions">
  ripCount?: number
}

type SerializedGraphRegion = {
  regionId: RegionId
  d: HyperGraphHg["regions"][number]["d"]
  portIds: string[]
  assignments?: SerializedRegionPortAssignment[]
}

type SerializedConnection = {
  connectionId: string
  mutuallyConnectedNetworkId: string
  startRegionId: RegionId
  endRegionId: RegionId
  simpleRouteConnection?: ConnectionHg["simpleRouteConnection"]
}

type SerializedSolvedRoute = {
  connectionId: string
  requiredRip: boolean
  pointIds: string[]
}

export type SerializedHyperGraphSnapshot = {
  layerCount: number
  graph: {
    ports: SerializedGraphPort[]
    regions: SerializedGraphRegion[]
  }
  connections: SerializedConnection[]
  solvedRoutes: SerializedSolvedRoute[]
}

function serializeRegionAssignment(
  assignment: NonNullable<HyperGraphHg["regions"][number]["assignments"]>[number],
): SerializedRegionPortAssignment {
  return {
    regionPort1Id: assignment.regionPort1.d.portId,
    regionPort2Id: assignment.regionPort2.d.portId,
    connectionId: assignment.connection.connectionId,
  }
}

function serializeRegion(
  region: HyperGraphHg["regions"][number],
): SerializedGraphRegion {
  return {
    regionId: region.regionId,
    d: region.d,
    portIds: region.ports.map((port) => port.d.portId),
    assignments: region.assignments?.map(serializeRegionAssignment),
  }
}

function serializePort(port: HyperGraphHg["ports"][number]): SerializedGraphPort {
  const { regions: _regions, ...rawPort } = port.d
  return {
    portId: port.d.portId,
    region1Id: port.region1.regionId,
    region2Id: port.region2.regionId,
    d: rawPort,
    ripCount: port.ripCount,
  }
}

function serializeConnection(connection: ConnectionHg): SerializedConnection {
  return {
    connectionId: connection.connectionId,
    mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
    startRegionId: connection.startRegion.regionId,
    endRegionId: connection.endRegion.regionId,
    simpleRouteConnection: connection.simpleRouteConnection,
  }
}

export function serializeHyperGraphSnapshot(params: {
  graph: HyperGraphHg
  connections: ConnectionHg[]
  solvedRoutes: SolvedRoutesHg[]
  layerCount: number
}): SerializedHyperGraphSnapshot {
  return {
    layerCount: params.layerCount,
    graph: {
      regions: params.graph.regions.map(serializeRegion),
      ports: params.graph.ports.map(serializePort),
    },
    connections: params.connections.map(serializeConnection),
    solvedRoutes: params.solvedRoutes.map((route) => ({
      connectionId: route.connection.connectionId,
      requiredRip: route.requiredRip,
      pointIds: route.path.map((candidate) => candidate.port.d.portId),
    })),
  }
}
