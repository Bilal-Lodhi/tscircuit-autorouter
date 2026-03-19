import { expect, test } from "bun:test"
import { circuit003 } from "@tscircuit/autorouting-dataset-01"
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

test(
  "HyperGraphSectionOptimizer2_PortPointPathing uses a different shuffle seed for each section attempt",
  () => {
    const solver = new AutoroutingPipelineSolver4(circuit003 as any)

    solver.solveUntilPhase("hyperGraphSectionOptimizer")
    solver.step()

    const hgso = solver.hyperGraphSectionOptimizer
    expect(hgso).toBeDefined()

    const seeds: number[] = []
    let lastSectionSolver: object | null = null
    let steps = 0
    const maxSteps = 20_000

    while (
      !solver.failed &&
      !solver.solved &&
      seeds.length < 3 &&
      steps < maxSteps
    ) {
      solver.step()
      steps += 1

      const activeSectionSolver = hgso?.activeSubSolver as
        | ({ params?: { weights?: { SHUFFLE_SEED?: number } } } & object)
        | null
        | undefined

      if (activeSectionSolver && activeSectionSolver !== lastSectionSolver) {
        seeds.push(
          activeSectionSolver.params?.weights?.SHUFFLE_SEED ?? Number.NaN,
        )
        lastSectionSolver = activeSectionSolver
        ;(activeSectionSolver as any).solve()
      }

      if (!activeSectionSolver) {
        lastSectionSolver = null
      }
    }

    expect(steps).toBeLessThan(maxSteps)
    expect(seeds).toHaveLength(3)
    expect(new Set(seeds).size).toBe(seeds.length)
    expect(seeds[1]).toBe(seeds[0]! + 1)
    expect(seeds[2]).toBe(seeds[1]! + 1)
  },
  { timeout: 120_000 },
)
