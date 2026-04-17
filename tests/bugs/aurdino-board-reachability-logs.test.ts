import { test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/aurdino board!/escapeViaLocationSolver_input.json" with {
  type: "json",
}

const srj = (Array.isArray(bugReport) ? bugReport[0] : bugReport) as SimpleRouteJson

test("aurdino board reachability logs", () => {
  const solver = new AutoroutingPipelineSolver4(srj)
  solver.solve()
})
