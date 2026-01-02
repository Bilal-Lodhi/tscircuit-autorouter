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
        name: "orderings6",
        possibleValues: Array.from({ length: 6 }, (_, i) => ({
          SHUFFLE_SEED: i,
        })),
      },
    ]
  }

  getCombinationDefs() {
    return [["orderings6"]]
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
}
