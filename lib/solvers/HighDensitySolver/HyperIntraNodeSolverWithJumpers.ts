import type {
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { IntraNodeSolverWithJumpers } from "./IntraNodeSolverWithJumpers"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import type { GraphicsObject } from "graphics-debug"

export class HyperIntraNodeSolverWithJumpers extends HyperParameterSupervisorSolver<IntraNodeSolverWithJumpers> {
  constructorParams: ConstructorParameters<typeof IntraNodeSolverWithJumpers>[0]
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap

  constructor(
    opts: ConstructorParameters<typeof IntraNodeSolverWithJumpers>[0],
  ) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.MAX_ITERATIONS = 100_000
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
  }

  getHyperParameterDefs() {
    return [
      {
        name: "orderings20",
        possibleValues: Array.from({ length: 20 }, (_, i) => ({
          SHUFFLE_SEED: i,
        })),
      },
      // {
      //   name: "misc",
      //   possibleValues: [
      //     {
      //       OBSTACLE_PROX_SIGMA: 0,
      //     },
      //   ] as Array<HighDensityHyperParameters>,
      // },
    ]
  }

  getCombinationDefs() {
    return [["orderings20"]]
    // return [["orderings20", "misc"]]
  }

  _step() {
    super._step()
    this.stats.bestFitnessHyperParameters =
      this.getSupervisedSolverWithBestFitness()?.hyperParameters
  }

  computeG(solver: IntraNodeSolverWithJumpers) {
    return solver.iterations / 10_000
  }

  computeH(solver: IntraNodeSolverWithJumpers) {
    return 1 - (solver.progress || 0)
  }

  generateSolver(
    hyperParameters: Partial<HighDensityHyperParameters>,
  ): IntraNodeSolverWithJumpers {
    return new IntraNodeSolverWithJumpers({
      ...this.constructorParams,
      hyperParameters: {
        ...this.constructorParams.hyperParameters,
        ...hyperParameters,
      },
    })
  }

  onSolve(solver: SupervisedSolver<IntraNodeSolverWithJumpers>) {
    this.solvedRoutes = solver.solver.solvedRoutes
  }

  visualize(): GraphicsObject {
    // Use winning solver if available, otherwise fall back to best fitness solver
    if (this.winningSolver) {
      return this.winningSolver.visualize()
    }
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    return super.visualize()
  }
}
