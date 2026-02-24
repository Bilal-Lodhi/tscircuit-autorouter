import { HyperGraph, Region, RegionId, RegionPort } from "@tscircuit/hypergraph"
import {
  BasePipelineSolver,
  BaseSolver,
  PipelineStep,
} from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { CapacityMeshNode } from "lib/types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { areAllRegionPortsBlocked } from "./areAllRegionPortsBlocked"
import { depthLimitedBfsSolver } from "./depthLimitedBfsSolver"
import { doesLineIntersectLine } from "@tscircuit/math-utils"

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

type HopCheckSolverInput = {
  graph: TypedHyperGraph
  graphWithCrampedRegionPort: TypedHyperGraph
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
  private allRegionWithObstacle: TypedRegion[]

  override getSolverName(): string {
    return "HopCheckSolver"
  }

  constructor(private input: HopCheckSolverInput) {
    super(input)
    this.regionsWithObstacleQueue = input.graph.regions.filter(
      (region) => region.d._containsObstacle,
    )
    this.allRegionWithObstacle = input.graph.regions.filter(
      (region) => region.d._containsObstacle,
    )
    this.regionsWithObstacleQueue.sort((a, b) => a.d.center.x - b.d.center.x)
  }

  step(): void {
    this.currentRegionWithObstacle = this.regionsWithObstacleQueue.shift()
    if (!this.currentRegionWithObstacle) {
      this.solved = true
      return
    }
    this.outputPortOfBfs = depthLimitedBfsSolver({
      depthLimit: 2,
      targetRegion: this.currentRegionWithObstacle,
    })

    if (areAllRegionPortsBlocked(this.outputPortOfBfs)) {

      // since we have the regions that are at level 2 depth
      // and if we find a single cramped port in any of the
      // returned regions that is related to returned port that is it
      for (const currentRegionPort of this.outputPortOfBfs) {
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
    let graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    if (!this.currentRegionWithObstacle) {
      for (const region of this.allRegionWithObstacle) {
        graphics.rects?.push({
          ...region.d,
          fill: "rgb(255, 0, 0, 0.5)",
          layer: `availableZ=${region.d.availableZ}`,
          label: `${region.regionId}`,
        })
      }
      return graphics
    }

    for (const region of this.allRegionWithObstacle) {
      graphics.rects?.push({
        ...region.d,
        fill:
          this.currentRegionWithObstacle === region
            ? "rgb(255, 0, 0, 0.5)"
            : "rgb(255, 0, 0, 0.2)",
        layer: `availableZ=${region.d.availableZ}`,
        label: `${region.regionId}`,
      })
    }

    for (const port of this.outputPortOfBfs) {
      graphics.points?.push({
        ...port.d,
        color: "green",
        layer: `availableZ=${port.d.availableZ}`,
        label: `${port.portId}`,
      })
    }

    if (this.visualizationPhase === "withCrampedPortPoints") {
      this.visualizationPhase = "withPortPoints"
      for (const crampedRegionPort of this.crampedPortPointsToInclude) {
        graphics.rects?.push({
          width: 0.5,
          height: 0.5,
          center: {
            x: crampedRegionPort.d.x,
            y: crampedRegionPort.d.y,
          },
          layer: `availableZ=${crampedRegionPort.d.availableZ}`,
          label: `cramped-port ${crampedRegionPort.portId}`,
          fill: "green",
        })
      }
    }

    return graphics
  }
}
