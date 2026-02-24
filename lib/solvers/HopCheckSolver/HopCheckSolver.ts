import { HyperGraph, Region, RegionId, RegionPort } from "@tscircuit/hypergraph"
import {
  BasePipelineSolver,
  BaseSolver,
  PipelineStep,
} from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
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

type HopCheckSolverInput = {
  graph: TypedHyperGraph
  graphWithCrampedRegionPort: TypedHyperGraph
  connectionNameToGoalRegionIds: Record<ConnectionName, RegionId[]>
}

export class HopCheckSolver extends BasePipelineSolver<HopCheckSolverInput> {
  pipelineDef: PipelineStep<BaseSolver>[] = []
  regionsWithObstacleQueue: TypedRegion[]
  private crampedPortPointsToInclude: Set<TypedRegionPort> =
    new Set<TypedRegionPort>()
  private currentRegionWithObstacle: TypedRegion | undefined
  private outputPortOfBfs: TypedRegionPort[] = []
  private visualizationPhase: "withPortPoints" | "withCrampedPortPoints" =
    "withPortPoints"

  override getSolverName(): string {
    return "HopCheckSolver"
  }

  constructor(private input: HopCheckSolverInput) {
    super(input)
    this.regionsWithObstacleQueue = input.graph.regions.filter(
      (region) => region.d._containsObstacle,
    )
  }

  step(): void {
    this.currentRegionWithObstacle = this.regionsWithObstacleQueue.shift()
    if (!this.currentRegionWithObstacle) {
      return
    }
    const outputPortOfBfs = depthLimitedBfsSolver({
      depthLimit: 2,
      targetRegion: this.currentRegionWithObstacle,
    })
    if (areAllRegionPortsBlocked(outputPortOfBfs)) {
      // since we have the regions that are at level 2 depth
      // and if we find a single cramped port in any of the
      // returned regions that is it
      for (const currentRegionPort of outputPortOfBfs) {
        this.visualizationPhase = "withCrampedPortPoints"
        const crampedRegionPort =
          this.input.graphWithCrampedRegionPort.ports.find(
            (p) =>
              p.region1.regionId === currentRegionPort.region1.regionId &&
              p.region2.regionId === currentRegionPort.region2.regionId,
          ) // each side always has 1 cramped port not more
        if (crampedRegionPort) {
          this.crampedPortPointsToInclude.add(crampedRegionPort)
          break
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

      const newPort: TypedRegionPort = {
        ...crampedRegionPort,
        region1,
        region2,
      }

      region1.ports = [...region1.ports, newPort]
      region2.ports = [...region2.ports, newPort]

      cloneInputGraph.ports = [...cloneInputGraph.ports, newPort]
    }

    return cloneInputGraph
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      circles: [],
      points: [],
      lines: [],
      texts: [],
    }

    if (!this.currentRegionWithObstacle) {
      return graphics
    }

    // highligh the current region with target obstacle
    graphics.rects?.push({
      ...this.currentRegionWithObstacle.d,
      color: "red",
      layer: `availableZ=${this.currentRegionWithObstacle.d.availableZ}`
    })

    for(const port of this.outputPortOfBfs) {
      graphics.points?.push({
        ...port.d,
        color: "green",
        layer: `availableZ=${port.d.z}`
      })
    }

    switch (this.visualizationPhase) {
      case "withCrampedPortPoints": {
        this.visualizationPhase = "withPortPoints"
          for (const crampedRegionPort of this.crampedPortPointsToInclude) {
            graphics.rects?.push({
              width: .5,
              height: .5,
              center: {
                x: crampedRegionPort.d.x,
                y: crampedRegionPort.d.y,
              },
              layer: `availableZ=${crampedRegionPort.d.z}`,
              color: "green"
            })
          }
        break
      }
    }

    return graphics
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
  if (depthLimit < 1) return []
  const visitedPortIds = new Set<string>()
  const queue: { port: TypedRegionPort; depth: number }[] =
    targetRegion.ports.map((port) => ({ port, depth: 1 }))
  const result: TypedRegionPort[] = []
  for (const { port } of queue) {
    visitedPortIds.add(port.portId)
  }

  while (queue.length > 0) {
    const { port, depth } = queue.shift()!
    if (depth === depthLimit) {
      result.push(port)
      continue
    }

    const nextRegionPort = [port.region1.ports, port.region2.ports].flat()

    for (const nextPort of nextRegionPort) {
      if (visitedPortIds.has(nextPort.portId)) {
        continue
      }
      visitedPortIds.add(nextPort.portId)
      queue.push({ port: nextPort, depth: depth + 1 })
    }
  }

  return result
}
