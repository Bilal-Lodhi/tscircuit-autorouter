import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { CachedIntraNodeRouteSolver } from "../HighDensitySolver/CachedIntraNodeRouteSolver"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import { SingleTransitionCrossingRouteSolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { SingleTransitionIntraNodeSolver } from "../HighDensitySolver/SingleTransitionIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

export class HyperSingleIntraNodeSolver extends HyperParameterSupervisorSolver<
  | IntraNodeRouteSolver
  | TwoCrossingRoutesHighDensitySolver
  | SingleTransitionCrossingRouteSolver
  | SingleTransitionIntraNodeSolver
> {
  constructorParams: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap

  constructor(
    opts: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0],
  ) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.MAX_ITERATIONS = 250_000
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
  }

  getCombinationDefs() {
    return [
      ["multiHeadPolyLine"],
      ["majorCombinations", "orderings6", "cellSizeFactor"],
      ["noVias"],
      ["orderings50"],
      ["flipTraceAlignmentDirection", "orderings6"],
      ["closedFormSingleTrace"],
      ["closedFormTwoTrace"],
    ]
  }

  getHyperParameterDefs() {
    const { smallSeedCount, largeSeedCount } =
      this.computeShuffleSeedCountsForNode()
    const orderingsSmall = this.createShuffleSeedValues(smallSeedCount, 0)
    const orderingsLarge = this.createShuffleSeedValues(largeSeedCount, 100)

    return [
      {
        name: "majorCombinations",
        possibleValues: [
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 10,
            MISALIGNED_DIST_PENALTY_FACTOR: 5,
          },
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 0.5,
            FUTURE_CONNECTION_PROXIMITY_VD: 5,
            MISALIGNED_DIST_PENALTY_FACTOR: 2,
          },
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 10,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 5,
            MISALIGNED_DIST_PENALTY_FACTOR: 10,
            VIA_PENALTY_FACTOR_2: 1,
          },
        ],
      },
      {
        name: "orderings6",
        possibleValues: orderingsSmall,
      },
      {
        name: "cellSizeFactor",
        possibleValues: [
          {
            CELL_SIZE_FACTOR: 0.5,
          },
          {
            CELL_SIZE_FACTOR: 1,
          },
        ],
      },
      {
        name: "flipTraceAlignmentDirection",
        possibleValues: [
          {
            FLIP_TRACE_ALIGNMENT_DIRECTION: true,
          },
        ],
      },
      {
        name: "noVias",
        possibleValues: [
          {
            CELL_SIZE_FACTOR: 2,
            VIA_PENALTY_FACTOR_2: 10,
          },
        ],
      },
      {
        name: "orderings50",
        possibleValues: orderingsLarge,
      },
      {
        name: "closedFormTwoTrace",
        possibleValues: [
          {
            CLOSED_FORM_TWO_TRACE_SAME_LAYER: true,
          },
          {
            CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING: true,
          },
        ],
      },
      {
        name: "closedFormSingleTrace",
        possibleValues: [
          {
            CLOSED_FORM_SINGLE_TRANSITION: true,
          },
        ],
      },
      {
        name: "multiHeadPolyLine",
        possibleValues: [
          {
            MULTI_HEAD_POLYLINE_SOLVER: true,
            SEGMENTS_PER_POLYLINE: 6,
            BOUNDARY_PADDING: 0.05,
          },
          {
            MULTI_HEAD_POLYLINE_SOLVER: true,
            SEGMENTS_PER_POLYLINE: 6,
            BOUNDARY_PADDING: -0.05, // Allow vias/traces outside the boundary
            ITERATION_PENALTY: 10000,
            MINIMUM_FINAL_ACCEPTANCE_GAP: 0.001,
          },
        ],
      },
    ]
  }

  computeG(solver: IntraNodeRouteSolver) {
    if (solver?.hyperParameters?.MULTI_HEAD_POLYLINE_SOLVER) {
      return (
        1000 +
        ((solver.hyperParameters?.ITERATION_PENALTY ?? 0) + solver.iterations) /
          10_000 +
        10_000 * (solver.hyperParameters.SEGMENTS_PER_POLYLINE! - 3)
      )
    }
    return (
      solver.iterations / 10_000 // + solver.hyperParameters.SHUFFLE_SEED! * 0.05
    )
  }

  computeH(solver: IntraNodeRouteSolver) {
    return 1 - (solver.progress || 0)
  }

  generateSolver(hyperParameters: any): IntraNodeRouteSolver {
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
      return new TwoCrossingRoutesHighDensitySolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
      return new SingleTransitionCrossingRouteSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.CLOSED_FORM_SINGLE_TRANSITION) {
      return new SingleTransitionIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) {
      return new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: this.nodeWithPortPoints,
        connMap: this.connMap,
        hyperParameters: hyperParameters,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    return new CachedIntraNodeRouteSolver({
      ...this.constructorParams,
      hyperParameters,
    })
  }

  onSolve(solver: SupervisedSolver<IntraNodeRouteSolver>) {
    this.solvedRoutes = solver.solver.solvedRoutes.map((route) => {
      const matchingPortPoint = this.nodeWithPortPoints.portPoints.find(
        (p) => p.connectionName === route.connectionName,
      )
      if (matchingPortPoint?.rootConnectionName) {
        return {
          ...route,
          rootConnectionName: matchingPortPoint.rootConnectionName,
        }
      }
      return route
    })
  }

  private computeShuffleSeedCountsForNode() {
    const portCount = this.nodeWithPortPoints.portPoints.length
    const uniqueConnections = new Set(
      this.nodeWithPortPoints.portPoints.map((p) => p.connectionName),
    ).size
    const area = Math.max(
      1,
      this.nodeWithPortPoints.width * this.nodeWithPortPoints.height,
    )
    const normalizedArea = Math.sqrt(area)
    // Blend connection count, total ports, and footprint area to approximate
    // how challenging the node is so we can scale shuffle attempts accordingly.
    const complexityScore =
      uniqueConnections * 4 + portCount * 2 + normalizedArea

    const smallSeedCount = this.clampSeedCount(
      Math.round(Math.max(6, complexityScore / 6)),
      6,
      40,
    )
    const largeSeedCount = this.clampSeedCount(
      Math.round(Math.max(20, complexityScore / 2)),
      20,
      200,
    )

    return { smallSeedCount, largeSeedCount }
  }

  private clampSeedCount(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value))
  }

  private createShuffleSeedValues(count: number, offset: number) {
    const safeCount = Math.max(1, Math.floor(count))
    return Array.from({ length: safeCount }, (_, i) => ({
      SHUFFLE_SEED: offset + i,
    }))
  }
}
