import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers"
import input from "./jumper-high-density09-input.json"
import { HyperIntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/HyperIntraNodeSolverWithJumpers"
import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver"

export default () => {
  const createSolver = () => {
    return new HyperJumperPrepatternSolver2({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      hyperParameters: input.hyperParameters,
      traceWidth: input.traceWidth,
    })
  }

  return <GenericSolverDebugger autoStepOnce createSolver={createSolver} />
}
