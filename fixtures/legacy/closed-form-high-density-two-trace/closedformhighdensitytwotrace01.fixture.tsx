import cn159 from "fixtures/legacy/assets/cn159-nodeWithPortPoints.json" with {
  type: "json",
}
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { TwoCrossingRoutesHighDensitySolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new TwoCrossingRoutesHighDensitySolver({
          nodeWithPortPoints: cn159.nodeWithPortPoints,
        })
      }
    />
  )
}
