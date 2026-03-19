import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver4"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json" with {
  type: "json",
}

test(
  "bugreport23 - pipeline4 should not throw when ripping threshold is very low",
  () => {
    const solver = new AutoroutingPipelineSolver4(
      bugreport23 as unknown as SimpleRouteJson,
      {
        effort: 1,
      },
    )

    while (
      !solver.failed &&
      !solver.solved &&
      solver.getCurrentPhase() !== "portPointPathingSolver"
    ) {
      solver.step()
    }

    solver.step()

    expect(solver.portPointPathingSolver).toBeDefined()
    solver.portPointPathingSolver!.params.weights.START_RIPPING_PF_THRESHOLD = 0.05

    const maxSteps = 100_000
    let steps = 0
    while (
      !solver.failed &&
      !solver.solved &&
      solver.getCurrentPhase() === "portPointPathingSolver" &&
      steps < maxSteps
    ) {
      solver.step()
      steps += 1
    }

    expect(solver.failed).toBe(false)
    expect(solver.getCurrentPhase()).not.toBe("portPointPathingSolver")
    expect(steps).toBeLessThan(maxSteps)
  },
  { timeout: 60_000 },
)
