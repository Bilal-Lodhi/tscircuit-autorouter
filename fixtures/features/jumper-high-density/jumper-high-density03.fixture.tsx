import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers"
import input from "./jumper-high-density03-input.json"
import { HyperIntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/HyperIntraNodeSolverWithJumpers"

export default () => {
  const createSolver = () => {
    return new HyperIntraNodeSolverWithJumpers({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      hyperParameters: input.hyperParameters,
      traceWidth: input.traceWidth,
    })
  }

  return <GenericSolverDebugger autoStepOnce createSolver={createSolver} />
}
