import cn19735 from "fixtures/legacy/assets/cn19735-nodeWithPortPoints.json" with {
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
          nodeWithPortPoints: cn19735.nodeWithPortPoints,
          hyperParameters: {},
        })
      }
    />
  )
}
