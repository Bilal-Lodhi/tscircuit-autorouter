import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import input from "./tracewidthsolver01-input.json"

export default () => {
  const createSolver = () => {
    const data = input[0] as any

    return new TraceWidthSolver({
      hdRoutes: data.hdRoutes,
      minTraceWidth: data.minTraceWidth,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
