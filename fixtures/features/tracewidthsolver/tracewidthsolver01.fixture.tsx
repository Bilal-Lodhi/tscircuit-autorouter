import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import input from "./tracewidthsolver01-input.json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => {
  const createSolver = () => {
    return new TraceWidthSolver({
      ...(input[0] as any),
      connMap: new ConnectivityMap(input[0].connMap.netMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
