import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2"
import input from "./hyper-jumper-prepattern03-input.json"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useMemo } from "react"

export default () => {
  const solver = useMemo(() => {
    return new HyperJumperPrepatternSolver2({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      traceWidth: input.traceWidth,
    })
  }, [])

  return <GenericSolverDebugger solver={solver as any} />
}
