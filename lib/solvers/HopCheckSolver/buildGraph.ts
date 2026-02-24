import { CapacityMeshNode } from "lib/types"
import { TypedHyperGraph, TypedRegion, TypedRegionPort } from "./types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

type buildGraphParams = {
  capacityMeshNodes: CapacityMeshNode[]
  portPoints: SegmentPortPoint[]
}

/**
 * Builds a typed hypergraph representation from the given capacity mesh nodes and port points. Each capacity mesh node corresponds to a region, and each port point corresponds to a region port connecting two regions.
 */
export const buildGraph = (params: buildGraphParams): TypedHyperGraph => {
  const graph: TypedHyperGraph = {
    ports: [],
    regions: [],
  }

  for (const cmNode of params.capacityMeshNodes) {
    const region: TypedRegion = {
      d: cmNode,
      ports: [],
      regionId: cmNode.capacityMeshNodeId,
    }
    graph.regions.push(region)
  }

  for (const port of params.portPoints) {
    const regionPort: TypedRegionPort = {
      d: port,
      portId: port.segmentPortPointId,
      region1: graph.regions.find((e) => e.regionId === port.nodeIds[0])!,
      region2: graph.regions.find((e) => e.regionId === port.nodeIds[1])!,
    }
    graph.ports.push(regionPort)
    regionPort.region1.ports.push(regionPort)
    regionPort.region2.ports.push(regionPort)
  }

  return graph
}
