import cn880 from "fixtures/legacy/assets/cn880-nodeWithPortPoints.json" with {
  type: "json",
}
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new IntraNodeRouteSolver({
          nodeWithPortPoints: cn880.nodeWithPortPoints,
        })
      }
    />
  )
}
