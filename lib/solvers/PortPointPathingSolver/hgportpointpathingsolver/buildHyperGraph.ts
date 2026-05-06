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
import type {
  RawPort,
  ConnectionHg,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
} from "./types"

const REGION_MATCH_EPS = 1e-8

const getPointLayers = (point: ConnectionPoint, layerCount: number) =>
  ("layers" in point ? point.layers : [point.layer]).map((layer) =>
    mapLayerNameToZ(layer, layerCount),
  )

const isPointOnBoundsEdge = (
  point: ConnectionPoint,
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | undefined,
) => {
  if (!bounds) return false
  return (
    Math.abs(point.x - bounds.minX) <= REGION_MATCH_EPS ||
    Math.abs(point.x - bounds.maxX) <= REGION_MATCH_EPS ||
    Math.abs(point.y - bounds.minY) <= REGION_MATCH_EPS ||
    Math.abs(point.y - bounds.maxY) <= REGION_MATCH_EPS
  )
}

const logMissingRegionDiagnostic = (params: {
  endpointLabel: "start" | "end"
  connection: SimpleRouteConnection
  point: ConnectionPoint
  regions: RegionHg[]
  layerCount: number
  bounds?: { minX: number; maxX: number; minY: number; maxY: number }
}) => {
  const pointLayers = getPointLayers(params.point, params.layerCount)
  const nearestRegions = params.regions
    .map((region) => {
      const distance = pointToBoxDistance(params.point, region.d)
      const sharedLayers = pointLayers.filter((z) => region.d.availableZ.includes(z))
      return {
        regionId: region.regionId,
        distance,
        sharedLayers,
        availableZ: region.d.availableZ,
        bounds: {
          minX: region.d.center.x - region.d.width / 2,
          maxX: region.d.center.x + region.d.width / 2,
          minY: region.d.center.y - region.d.height / 2,
          maxY: region.d.center.y + region.d.height / 2,
        },
      }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)

  const nearLayerCompatibleRegions = nearestRegions.filter(
    (region) =>
      region.sharedLayers.length > 0 && region.distance <= REGION_MATCH_EPS,
  )

  console.error(
    `[buildHyperGraph] missing ${params.endpointLabel} region for ${params.connection.name}`,
    JSON.stringify(
      {
        endpointLabel: params.endpointLabel,
        point: params.point,
        pointLayers,
        boardEdgePoint: isPointOnBoundsEdge(params.point, params.bounds),
        bounds: params.bounds,
        nearLayerCompatibleRegionCount: nearLayerCompatibleRegions.length,
        likelyStrictEqualityMiss:
          nearLayerCompatibleRegions.length > 0 &&
          nearLayerCompatibleRegions.every((region) => region.distance > 0),
        nearestRegions,
      },
      null,
      2,
    ),
  )
}

/**
 * Builds the hypergraph and connection list consumed by the HG pathing solver.
 */
export function buildHyperGraph(params: {
  simpleRouteJsonConnections: SimpleRouteConnection[]
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  layerCount: number
  bounds?: { minX: number; maxX: number; minY: number; maxY: number }
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

  for (const connection of params.simpleRouteJsonConnections) {
    const [startPoint, endPoint] = connection.pointsToConnect

    const startRegion = graph.regions.find((region) =>
      checkIfConnectionPointIsInRegion({
        point: startPoint,
        region,
        layerCount: params.layerCount,
      }),
    )
    const endRegion = graph.regions.find((region) =>
      checkIfConnectionPointIsInRegion({
        point: endPoint,
        region,
        layerCount: params.layerCount,
      }),
    )

    if (!startRegion) {
      logMissingRegionDiagnostic({
        endpointLabel: "start",
        connection,
        point: startPoint,
        regions: graph.regions,
        layerCount: params.layerCount,
        bounds: params.bounds,
      })
    }
    if (!endRegion) {
      logMissingRegionDiagnostic({
        endpointLabel: "end",
        connection,
        point: endPoint,
        regions: graph.regions,
        layerCount: params.layerCount,
        bounds: params.bounds,
      })
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
