import { MultipleHighDensityRouteStitchSolver } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputs from "fixtures/legacy/assets/highdensitystitchsolver4.json" with {
  type: "json",
}

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        return new MultipleHighDensityRouteStitchSolver(...(inputs as [any]))
      }}
    />
  )
}
