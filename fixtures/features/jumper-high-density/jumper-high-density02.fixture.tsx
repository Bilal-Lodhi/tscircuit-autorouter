import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers"
import input from "./jumper-high-density02-input.json"

export default () => {
  const createSolver = () => {
    return new IntraNodeSolverWithJumpers({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      hyperParameters: input.hyperParameters,
      traceWidth: input.traceWidth,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
