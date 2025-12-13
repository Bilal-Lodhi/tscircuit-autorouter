import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../../lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json"

test("bugreport23 - should not fail with null z property in port points", async () => {
  const solver = new AutoroutingPipelineSolver(
    bugreport23 as unknown as SimpleRouteJson,
  )

  solver.solveUntilPhase("highDensityRouteSolver")

  console.log(solver.multiSectionPortPointOptimizer?.stats)
})
