import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshNode,
  ConnectionPoint,
  SimpleRouteConnection,
} from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { assertDefined } from "./assertDefined"
import { checkIfConnectionPointIsInRegion } from "./checkIfConnectionPointIsInRegion"
import { sharedZLayers } from "./sharedZLayers"
import type {
  RawPort,
  ConnectionHg,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
} from "./types"

const getConnectionPointZLayers = (
  point: ConnectionPoint,
  layerCount: number,
) => {
  const layers = "layers" in point ? point.layers : [point.layer]
  return layers.map((layer) => mapLayerNameToZ(layer, layerCount))
}

const isRerouteConnection = (connection: SimpleRouteConnection) =>
  connection.name.includes("_reroute_") ||
  connection.rootConnectionName?.includes("_reroute_")

const isFullObstacleRegion = (region: RegionHg) => {
  if (region.d._containsObstacle !== true) return false
  if (region.d._containsTarget !== true) return true

  const netId =
    typeof (region.d as any).netId === "number"
      ? (region.d as any).netId
      : typeof (region.d as any).NetId === "number"
        ? (region.d as any).NetId
        : undefined
  return netId === undefined || netId === -1
}

const hasUsableGraphPorts = (region: RegionHg) =>
  region.ports.some((port) => {
    const otherRegion = port.region1 === region ? port.region2 : port.region1
    return !isFullObstacleRegion(otherRegion)
  })

const findRegionForConnectionPoint = ({
  point,
  regions,
  layerCount,
}: {
  point: ConnectionPoint
  regions: RegionHg[]
  layerCount: number
}) => {
  const containingRegion = regions.find((region) =>
    checkIfConnectionPointIsInRegion({
      point,
      region,
      layerCount,
    }),
  )
  if (containingRegion) return containingRegion

  const pointZLayers = getConnectionPointZLayers(point, layerCount)
  const compatibleRegions = regions.filter(
    (region) => sharedZLayers(pointZLayers, region.d.availableZ).length > 0,
  )
  const fallbackRegions =
    compatibleRegions.length > 0 ? compatibleRegions : regions

  return fallbackRegions
    .map((region) => ({
      region,
      distance: pointToBoxDistance(point, region.d),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.region
}

const getRegionCandidatesForConnectionPoint = ({
  point,
  regions,
  layerCount,
}: {
  point: ConnectionPoint
  regions: RegionHg[]
  layerCount: number
}) => {
  const getSortedRegions = (candidateRegions: RegionHg[]) =>
    [...candidateRegions]
      .map((region) => ({
        region,
        distance: pointToBoxDistance(point, region.d),
      }))
      .sort((a, b) => a.distance - b.distance)
      .map(({ region }) => region)

  const containingRegions = regions.filter((region) =>
    checkIfConnectionPointIsInRegion({
      point,
      region,
      layerCount,
    }),
  )
  const pointZLayers = getConnectionPointZLayers(point, layerCount)
  const compatibleRegions = regions.filter(
    (region) => sharedZLayers(pointZLayers, region.d.availableZ).length > 0,
  )

  const candidateGroups = [
    containingRegions.filter(
      (region) => hasUsableGraphPorts(region) && !region.d._containsObstacle,
    ),
    compatibleRegions.filter(
      (region) => hasUsableGraphPorts(region) && !region.d._containsObstacle,
    ),
    containingRegions.filter(hasUsableGraphPorts),
    compatibleRegions.filter(hasUsableGraphPorts),
    containingRegions,
    compatibleRegions,
    regions,
  ]

  const seenRegionIds = new Set<string>()
  const candidates: RegionHg[] = []

  for (const group of candidateGroups) {
    for (const region of getSortedRegions(group)) {
      if (seenRegionIds.has(region.regionId)) continue
      seenRegionIds.add(region.regionId)
      candidates.push(region)
    }
  }

  return candidates
}

const getRegionComponentIds = (regions: RegionHg[]) => {
  const adjacencyMap = new Map<string, Set<string>>()

  for (const region of regions) {
    adjacencyMap.set(region.regionId, new Set())
  }

  for (const region of regions) {
    if (isFullObstacleRegion(region)) continue

    for (const port of region.ports) {
      const otherRegion = port.region1 === region ? port.region2 : port.region1
      if (isFullObstacleRegion(otherRegion)) continue

      adjacencyMap.get(region.regionId)?.add(otherRegion.regionId)
      adjacencyMap.get(otherRegion.regionId)?.add(region.regionId)
    }
  }

  const componentIds = new Map<string, number>()
  let nextComponentId = 0

  for (const region of regions) {
    if (componentIds.has(region.regionId)) continue

    const componentId = nextComponentId++
    const queue = [region.regionId]
    componentIds.set(region.regionId, componentId)

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const currentRegionId = queue[queueIndex]!
      for (const nextRegionId of adjacencyMap.get(currentRegionId) ?? []) {
        if (componentIds.has(nextRegionId)) continue
        componentIds.set(nextRegionId, componentId)
        queue.push(nextRegionId)
      }
    }
  }

  return componentIds
}

const findRegionPairForConnectionPoints = ({
  startPoint,
  endPoint,
  regions,
  layerCount,
  componentIds,
}: {
  startPoint: ConnectionPoint
  endPoint: ConnectionPoint
  regions: RegionHg[]
  layerCount: number
  componentIds: Map<string, number>
}) => {
  const startCandidates = getRegionCandidatesForConnectionPoint({
    point: startPoint,
    regions,
    layerCount,
  })
  const endCandidates = getRegionCandidatesForConnectionPoint({
    point: endPoint,
    regions,
    layerCount,
  })

  for (const startRegion of startCandidates) {
    const startComponentId = componentIds.get(startRegion.regionId)
    if (startComponentId === undefined) continue

    for (const endRegion of endCandidates) {
      if (componentIds.get(endRegion.regionId) === startComponentId) {
        return { startRegion, endRegion }
      }
    }
  }

  return {
    startRegion: startCandidates[0],
    endRegion: endCandidates[0],
  }
}

/**
 * Builds the hypergraph and connection list consumed by the HG pathing solver.
 */
export function buildHyperGraph(params: {
  simpleRouteJsonConnections: SimpleRouteConnection[]
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  layerCount: number
}): { graph: HyperGraphHg; connections: ConnectionHg[] } {
  const graph: HyperGraphHg = {
    ports: [],
    regions: [],
  }
  const connections: ConnectionHg[] = []

  for (const cmnNode of params.capacityMeshNodes) {
    graph.regions.push({
      regionId: cmnNode.capacityMeshNodeId,
      d: cmnNode,
      ports: [],
    })
  }

  for (const spp of params.segmentPortPoints) {
    const [region1Id, region2Id] = spp.nodeIds
    const region1 = graph.regions.find(
      (region) => region.regionId === region1Id,
    )
    const region2 = graph.regions.find(
      (region) => region.regionId === region2Id,
    )

    assertDefined(
      region1,
      `Could not find region with id ${region1Id} for segment port point ${spp.segmentPortPointId}`,
    )
    assertDefined(
      region2,
      `Could not find region with id ${region2Id} for segment port point ${spp.segmentPortPointId}`,
    )

    for (const z of spp.availableZ) {
      const port: RawPort = {
        portId: `${spp.segmentPortPointId}::${z}`,
        x: spp.x,
        y: spp.y,
        z,
        distToCentermostPortOnZ: spp.distToCentermostPortOnZ,
        regions: [region1, region2],
      }
      const hgPort: RegionPortHg = {
        portId: spp.segmentPortPointId,
        d: port,
        region1,
        region2,
      }
      graph.ports.push(hgPort)
      region1.ports.push(hgPort)
      region2.ports.push(hgPort)
    }
  }

  const componentIds = getRegionComponentIds(graph.regions)

  for (const connection of params.simpleRouteJsonConnections) {
    const [startPoint, endPoint] = connection.pointsToConnect

    const { startRegion, endRegion } = isRerouteConnection(connection)
      ? findRegionPairForConnectionPoints({
          startPoint,
          endPoint,
          regions: graph.regions,
          layerCount: params.layerCount,
          componentIds,
        })
      : {
          startRegion: findRegionForConnectionPoint({
            point: startPoint,
            regions: graph.regions,
            layerCount: params.layerCount,
          }),
          endRegion: findRegionForConnectionPoint({
            point: endPoint,
            regions: graph.regions,
            layerCount: params.layerCount,
          }),
        }

    assertDefined(
      startRegion,
      `Could not find start region for connection "${connection.name}"`,
    )
    assertDefined(
      endRegion,
      `Could not find end region for connection "${connection.name}"`,
    )

    connections.push({
      connectionId: connection.name,
      mutuallyConnectedNetworkId:
        connection.rootConnectionName ?? connection.name,
      startRegion,
      endRegion,
      simpleRouteConnection: connection,
    })
  }

  return { graph, connections }
}
