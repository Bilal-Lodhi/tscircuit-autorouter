import { HyperGraph, Region, RegionId, RegionPort } from "@tscircuit/hypergraph"
import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
  PipelineStep,
} from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { CapacityMeshNode } from "lib/types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { areAllRegionPortsBlocked } from "./areAllRegionPortsBlocked"
import {
  candidateToPath,
  depthLimitedBfs,
  selectBestCandidate,
} from "./depthLimitedBfsSolver"

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
}

class FindUnreachableRegionsContainingObstacleSolver extends BaseSolver {
  regionsWithObstacleQueue: TypedRegion[]
  private currentRegionWithObstacle: TypedRegion | undefined
  private outputPortOfBfs: TypedRegionPort[] = []
  private allRegionWithObstacle: TypedRegion[]
  private unreachableRegionsContainingObstacle: TypedRegion[] = []

  override getSolverName(): string {
    return "findUnreachableRegionsContainingObstacleSolver"
  }

  constructor(private input: HopCheckSolverInput) {
    super()
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
    const { portPointsAtNthDegree } = depthLimitedBfs({
      depthLimit: 2,
      targetRegion: this.currentRegionWithObstacle,
      shouldIgnoreCrampedPortPoints: true,
    })
    this.outputPortOfBfs = portPointsAtNthDegree

    if (areAllRegionPortsBlocked(this.outputPortOfBfs)) {
      this.unreachableRegionsContainingObstacle.push(
        this.currentRegionWithObstacle,
      )
    }
  }

  getOutput(): Region[] {
    return this.unreachableRegionsContainingObstacle
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

    for (const region of this.unreachableRegionsContainingObstacle) {
      graphics.rects?.push({
        ...region.d,
        fill: "rgb(0, 0, 255, 0.5)",
        layer: `availableZ=${region.d.availableZ}`,
        label: `${region.regionId} (unreachable)`,
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

    return graphics
  }
}

type FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolverInput =
  HopCheckSolverInput & {
    regionsWithObstacle: TypedRegion[]
  }

class FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver extends BaseSolver {
  private regionsWithObstacleQueue: TypedRegion[]
  private currentRegionWithObstacle: TypedRegion | undefined
  private visitedPortPoints: TypedRegionPort[] = []
  private bestPath: TypedRegionPort[] = []
  override getSolverName(): string {
    return "findCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver"
  }

  constructor(
    private input: FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolverInput,
  ) {
    super()
    this.regionsWithObstacleQueue = [...this.input.regionsWithObstacle]
  }

  step(): void {
    if (this.regionsWithObstacleQueue.length === 0) {
      this.solved = true
      return
    }
    this.currentRegionWithObstacle = this.regionsWithObstacleQueue.shift()!
    const {
      portPointsAtNthDegree,
      visitedPortPoints,
      outputCandidatesAtNthDegreeWhoDoNotShareWithObstacle:
        outputCandidatesAtNthDegree,
    } = depthLimitedBfs({
      depthLimit: 2,
      targetRegion: this.currentRegionWithObstacle,
      shouldIgnoreCrampedPortPoints: false,
    })
    this.visitedPortPoints = visitedPortPoints
    if (areAllRegionPortsBlocked(portPointsAtNthDegree)) {
      this.failed = true
      this.error = `Region ${this.currentRegionWithObstacle.regionId} is unreachable even after considering cramped port points`
      return
    }
    if (outputCandidatesAtNthDegree.length === 0) {
      this.failed = true
      this.error = `Region ${this.currentRegionWithObstacle.regionId} has no valid candidate path after obstacle-sharing filter`
      return
    }
    this.bestPath = [
      ...this.bestPath,
      ...candidateToPath(selectBestCandidate(outputCandidatesAtNthDegree)),
    ]
  }

  getOutput(): TypedRegionPort[] {
    return this.bestPath
  }

  visualize(): GraphicsObject {
    let graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    for (const region of this.input.regionsWithObstacle) {
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

    for (const visited of this.bestPath) {
      if (!visited.d.cramped) {
        graphics.points?.push({
          ...visited.d,
          color: "green",
          layer: `availableZ=${visited.d.availableZ}`,
          label: `${visited.portId}`,
        })
      } else {
        graphics.rects?.push({
          ...visited.d,
          center: {
            x: visited.d.x,
            y: visited.d.y,
          },
          width: 0.1,
          height: 0.1,
          fill: "green",
          layer: `availableZ=${visited.d.availableZ}`,
          label: `${visited.portId}`,
        })
      }
    }

    return graphics
  }
}

export class HopCheckSolverPipeline extends BasePipelineSolver<HopCheckSolverInput> {
  findUnreachableRegionsContainingObstacleSolver?: FindUnreachableRegionsContainingObstacleSolver
  findCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver?: FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "findUnreachableRegionsContainingObstacleSolver",
      FindUnreachableRegionsContainingObstacleSolver,
      (cms: HopCheckSolverPipeline) => {
        return [cms.inputProblem]
      },
    ),
    definePipelineStep(
      "findCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver",
      FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver,
      (cms: HopCheckSolverPipeline) => {
        const unreachableRegionsContainingObstacle =
          cms.findUnreachableRegionsContainingObstacleSolver?.getOutput() ?? []
        return [
          {
            ...cms.inputProblem,
            regionsWithObstacle: unreachableRegionsContainingObstacle,
          },
        ]
      },
    ),
  ]

  override getSolverName(): string {
    return "HopCheckSolverPipeline"
  }

  getOutput(): TypedHyperGraph {
    const graph = structuredClone(this.inputProblem.graph)
    const bestPath =
      this.findCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver?.getOutput() ??
      []

    if (bestPath.length === 0) {
      return graph
    }

    const portsToUncramp = new Set(bestPath.map((port) => port.portId))
    for (const portId of portsToUncramp) {
      const graphPort = graph.ports.find((p) => p.portId === portId)!
      // TODO: we unmark some of the cramped port points as not cramped,
      // but this is not the best way to do it.
      // because we are changing the clone of the original graph
      // which can be not super intuitive.
      graphPort.d.cramped = false
    }

    // delete all port points whose cramped is true
    graph.ports = graph.ports.filter((port) => !port.d.cramped)
    for (const region of graph.regions) {
      region.ports = region.ports.filter((port) => !port.d.cramped)
    }

    return graph
  }

  finalVisualize(): GraphicsObject | null {
    let graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    return graphics
  }
}
