import { HyperGraph, Region, RegionId, RegionPort } from "@tscircuit/hypergraph"
import {
  BasePipelineSolver,
  BaseSolver,
  PipelineStep,
} from "@tscircuit/solver-utils"
import { CapacityMeshNode } from "lib/types"
import { PortPoint } from "lib/types/high-density-types"

type ConnectionName = string

type TypedRegion = Omit<Region, "d"> & {
  d: CapacityMeshNode
}
type TypedRegionPort = Omit<RegionPort, "d"> & {
  d: PortPoint
}

type TypedHyperGraph = Omit<HyperGraph, "ports" | "regions"> & {
  ports: TypedRegionPort[]
  regions: TypedRegion[]
}

type HopeCheckSolverInput = {
  graph: TypedHyperGraph
  graphWithCrampedRegionPort: TypedHyperGraph
  connectionNameToGoalRegionIds: Record<ConnectionName, RegionId[]>
}

export class HopeCheckSolver extends BasePipelineSolver<HopeCheckSolverInput> {
  pipelineDef: PipelineStep<BaseSolver>[] = []
  regionsWithObstacleQueue: TypedRegion[]
  private crampedPortPointsToInclude: Set<TypedRegionPort> =
    new Set<TypedRegionPort>()

  override getSolverName(): string {
    return "HopeCheckSolver"
  }

  constructor(private input: HopeCheckSolverInput) {
    super(input)
    this.regionsWithObstacleQueue = input.graph.regions.filter(
      (region) => region.d._containsObstacle,
    )
  }

  step(): void {
    const currentRegionWithObstacle = this.regionsWithObstacleQueue.shift()
    if (!currentRegionWithObstacle) {
      return
    }
    const res = depthLimitedBfsSolver({
      depthLimit: 2,
      targetRegion: currentRegionWithObstacle,
    })
    if (areAllRegionPortsBlocked(res)) {
      // iterated over the result port points
      // and using the region Id get an cramped region port from the graph with cramped region port
      // and store the id of the cramped region port
      // in the final output it will be include as an port points
      for (const regionPort of res) {
        const crampedRegionPort =
          this.input.graphWithCrampedRegionPort.ports.find(
            (p) =>
              p.region1.regionId === regionPort.region1.regionId &&
              p.region2.regionId === regionPort.region2.regionId,
          )
        if (crampedRegionPort) {
          this.crampedPortPointsToInclude.add(crampedRegionPort)
        }
      }
    }
  }

  getOutput(): TypedHyperGraph {
    if (this.crampedPortPointsToInclude.size === 0) {
      return this.input.graph
    }

    const cloneInputGraph = structuredClone(this.input.graph)

    for (const crampedRegionPort of this.crampedPortPointsToInclude) {
      const region1 = cloneInputGraph.regions.find(
        (p) => p.regionId === crampedRegionPort.region1.regionId,
      )!
      const region2 = cloneInputGraph.regions.find(
        (p) => p.regionId === crampedRegionPort.region2.regionId,
      )!

      const newRegion1Port: TypedRegionPort = {
        ...crampedRegionPort,
        region1,
        region2,
      }
      const newRegion2Port: TypedRegionPort = {
        ...crampedRegionPort,
        region1,
        region2,
      }

      region1.ports = [...region1.ports, newRegion1Port]
      region2.ports = [...region2.ports, newRegion2Port]

      cloneInputGraph.ports = [
        ...cloneInputGraph.ports,
        newRegion1Port,
        newRegion2Port,
      ]
    }

    return cloneInputGraph
  }
}

const areAllRegionPortsBlocked = (regionPorts: TypedRegionPort[]) => {
  for (const port of regionPorts) {
    const neighborRegions = [port.region1, port.region2]
    for (const neighborRegion of neighborRegions) {
      if (!neighborRegion.d._containsObstacle) {
        return false
      }
    }
  }
  return true
}

type depthLimitedBfsArgs = {
  targetRegion: TypedRegion
  depthLimit: number
}

const depthLimitedBfsSolver = (
  params: depthLimitedBfsArgs,
): TypedRegionPort[] => {
  const { targetRegion, depthLimit } = params
  const visitedPortIds = new Set<TypedRegionPort>()
  const queue: { port: TypedRegionPort; depth: number }[] =
    targetRegion.ports.map((e) => ({ port: e, depth: 0 }))
  const result: TypedRegionPort[] = []

  while (queue.length > 0) {
    const { port, depth } = queue.shift()!
    visitedPortIds.add(port)

    const nextRegionPort = [port.region1.ports, port.region2.ports].flat()

    for (const port of nextRegionPort) {
      if (visitedPortIds.has(port)) {
        continue
      }
      if (depth < depthLimit) {
        queue.push({ port, depth: depth + 1 })
      }
      if (depth === depthLimit) {
        result.push(port)
      }
    }
  }

  return result
}
