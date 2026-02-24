import { HyperGraph, Region, RegionPort } from "@tscircuit/hypergraph"
import { CapacityMeshNode } from "lib/types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type TypedRegion = Omit<Region, "d"> & {
  d: CapacityMeshNode
}
export type TypedRegionPort = Omit<RegionPort, "d"> & {
  d: SegmentPortPoint
}

export type TypedHyperGraph = Omit<HyperGraph, "ports" | "regions"> & {
  ports: TypedRegionPort[]
  regions: TypedRegion[]
}

export type HopCheckSolverInput = {
  graph: TypedHyperGraph
}

export type DepthLimitedBfsCandidate = {
  portPoint: TypedRegionPort
  depth: number
  parent: DepthLimitedBfsCandidate | null
}
