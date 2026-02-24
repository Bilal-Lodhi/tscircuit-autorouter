import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
  PipelineStep,
} from "@tscircuit/solver-utils"
import { FindUnreachableRegionsContainingObstacleSolver } from "./solver/FindUnreachableRegionsContainingObstacleSolver"
import { GraphicsObject } from "graphics-debug"
import { FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver } from "./solver/FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver"
import { HopCheckSolverInput, TypedHyperGraph } from "./types"
import { visualizeTypedHyperGraph } from "./visualization/visualizeTypedHyperGraph"

/**
 * The HopCheckSolverPipeline is a pipeline solver that orchestrates the process of
 * identifying unreachable regions containing obstacles and finding cramped port points
 * to make those regions reachable.
 */
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
      // TODO: We unmark some cramped port points here.
      // This works, but mutating the cloned graph in place is not ideal.
      graphPort.d.cramped = false
    }

    // Delete all port points whose cramped flag is true.
    graph.ports = graph.ports.filter((port) => !port.d.cramped)
    for (const region of graph.regions) {
      region.ports = region.ports.filter((port) => !port.d.cramped)
    }

    return graph
  }

  visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    return visualizeTypedHyperGraph(this.inputProblem.graph)
  }

  finalVisualize(): GraphicsObject | null {
    return visualizeTypedHyperGraph(this.getOutput())
  }
}
