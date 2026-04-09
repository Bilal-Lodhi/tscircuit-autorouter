import { IntraNodeRouteSolver } from "./IntraNodeSolver"

export const getIntraNodeStrategyName = (
  hyperParameters: Record<string, any> | undefined,
): string => {
  if (hyperParameters?.MULTI_HEAD_POLYLINE_SOLVER) {
    return "MultiHeadPolyLineIntraNodeSolver3"
  }
  if (hyperParameters?.SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS) {
    return "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
  }
  if (hyperParameters?.CLOSED_FORM_SINGLE_TRANSITION) {
    return "SingleTransitionIntraNodeSolver"
  }
  if (hyperParameters?.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
    return "TwoCrossingRoutesHighDensitySolver"
  }
  if (hyperParameters?.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
    return "SingleTransitionCrossingRouteSolver"
  }
  if (hyperParameters?.FIXED_TOPOLOGY_HIGH_DENSITY_INTRA_NODE_SOLVER) {
    return "FixedTopologyHighDensityIntraNodeSolver"
  }
  if (hyperParameters?.HIGH_DENSITY_A01) {
    return "HighDensitySolverA01"
  }
  if (hyperParameters?.HIGH_DENSITY_A03) {
    return "HighDensitySolverA03"
  }
  return "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
}

export const getConcreteIntraNodeSolverTypeName = (solver: unknown): string => {
  if (solver instanceof IntraNodeRouteSolver) {
    return getIntraNodeStrategyName(solver.hyperParameters)
  }

  if (
    solver &&
    typeof solver === "object" &&
    "getSolverName" in solver &&
    typeof solver.getSolverName === "function"
  ) {
    return solver.getSolverName()
  }

  const solverConstructor = (
    solver as {
      constructor?: {
        name?: string
      }
    } | null
  )?.constructor

  if (typeof solverConstructor?.name === "string") {
    return solverConstructor.name
  }

  return "unknown"
}
