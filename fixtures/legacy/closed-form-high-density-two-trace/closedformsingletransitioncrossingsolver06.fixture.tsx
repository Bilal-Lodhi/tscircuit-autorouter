import cn16233 from "fixtures/legacy/assets/cn16233-nodeWithPortPoints.json" with {
  type: "json",
}
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new SingleTransitionCrossingRouteSolver({
          nodeWithPortPoints: cn16233.nodeWithPortPoints,
          viaDiameter: 0.6,
          traceThickness: 0.15,
          obstacleMargin: 0.1,
        })
        return solver
      }}
    />
  )
}
