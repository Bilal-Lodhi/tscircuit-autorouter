import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver4"
import type { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"

test(
  "AutoroutingPipelineSolver4 uses HyperGraphSectionOptimizer2 for section optimization",
  () => {
    const solver = new AutoroutingPipelineSolver4(
      e2e3Fixture as SimpleRouteJson,
    )

    solver.solveUntilPhase("hyperGraphSectionOptimizer")
    solver.step()

    expect(solver.hyperGraphSectionOptimizer).toBeDefined()
    expect(solver.hyperGraphSectionOptimizer?.constructor.name).toBe(
      "HyperGraphSectionOptimizer2_PortPointPathing",
    )
    expect(solver.hyperGraphSectionOptimizer?.MAX_ITERATIONS).toBeGreaterThan(
      1_000,
    )
  },
  { timeout: 60_000 },
)
