import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver4"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json" with {
  type: "json",
}
import { stackGraphicsVertically } from "graphics-debug"
import kluer from "kleur"

test(
  "bugreport23 - pipeline4 should not fail with null z property in port points",
  async () => {
    const solver = new AutoroutingPipelineSolver4(
      bugreport23 as unknown as SimpleRouteJson,
      {
        effort: 1,
      },
    )

    while (solver.getCurrentPhase() !== "portPointPathingSolver") {
      solver.step()
    }
    while (solver.getCurrentPhase() === "portPointPathingSolver") {
      solver.step()
    }
    solver.step()

    const ppps = solver.portPointPathingSolver
    const hgso = solver.hyperGraphSectionOptimizer
    const startTime = Date.now()
    const time = () => `${((Date.now() - startTime) / 1000).toFixed(2)}s`

    console.log(
      0,
      Date.now() - startTime,
      hgso?.stats.initialBoardScore?.toFixed(2),
      ppps?.iterations,
      time(),
    )

    if (hgso) {
      ;(hgso as any).config.maxSectionAttempts = 10

      const ogViz = structuredClone(solver.portPointPathingSolver!.visualize())
      let bestScore = hgso.stats.currentBoardScore
      let lastCompletedSectionAttempt = hgso.sectionSolveEvents.length
      let phaseSteps = 0
      const maxPhaseSteps = 20_000

      console.log(0, bestScore.toFixed(2), kluer.red(hgso.stats.errors))

      while (
        solver.getCurrentPhase() !== "highDensityRouteSolver" &&
        phaseSteps < maxPhaseSteps
      ) {
        solver.step()
        phaseSteps += 1

        if (hgso.activeSubSolver) {
          hgso.activeSubSolver.solve()

          while (
            !solver.failed &&
            solver.getCurrentPhase() === "hyperGraphSectionOptimizer" &&
            hgso.sectionSolveEvents.length === lastCompletedSectionAttempt
          ) {
            solver.step()
          }

          lastCompletedSectionAttempt = hgso.sectionSolveEvents.length

          if (hgso.stats.currentBoardScore > bestScore) {
            bestScore = hgso.stats.currentBoardScore
            console.log(
              hgso.attemptedSectionCount,
              hgso.stats.currentBoardScore.toFixed(2),
              kluer.red(hgso.stats.errors),
              time(),
            )
          }
        }
      }

      expect(phaseSteps).toBeLessThan(maxPhaseSteps)
      expect(
        hgso.rootSolver.graph.ports.filter((port) => port._deadendInSection),
      ).toHaveLength(0)
      console.log(solver.hyperGraphSectionOptimizer?.stats)
      expect(
        stackGraphicsVertically([ogViz, hgso.rootSolver.visualize()]),
      ).toMatchGraphicsSvg(`${import.meta.path}-portPointPathingSolver`)
    }
  },
  { timeout: 60_000 },
)
