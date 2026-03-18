import { expect, test } from "bun:test"
import { circuit003 } from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver4"

test(
  "AutoroutingPipelineSolver4 runs section optimization on dataset-01 circuit003 with dead-end pruning, logs section results, and populates stage stats",
  () => {
    const solver = new AutoroutingPipelineSolver4(circuit003 as any)
    const maxSteps = 20_000
    const targetSectionEvents = 5
    let lastLoggedSectionEventIndex = 0
    let steps = 0

    while (
      !solver.solved &&
      !solver.failed &&
      steps < maxSteps &&
      (solver.hyperGraphSectionOptimizer?.sectionSolveEvents.length ?? 0) <
        targetSectionEvents
    ) {
      solver.step()
      steps += 1

      const sectionSolveEvents =
        solver.hyperGraphSectionOptimizer?.sectionSolveEvents ?? []

      while (lastLoggedSectionEventIndex < sectionSolveEvents.length) {
        const sectionSolveEvent =
          sectionSolveEvents[lastLoggedSectionEventIndex]!
        console.log(
          `[circuit003 section ${lastLoggedSectionEventIndex + 1}] ${JSON.stringify(sectionSolveEvent)}`,
        )
        lastLoggedSectionEventIndex += 1
      }
    }

    expect(solver.hyperGraphSectionOptimizer).toBeDefined()
    expect(solver.failed).toBe(false)
    expect(solver.hyperGraphSectionOptimizer?.sectionSolveEvents.length).toBe(
      targetSectionEvents,
    )

    const stats = solver.hyperGraphSectionOptimizer?.stats as
      | Record<string, unknown>
      | undefined

    expect(stats).toBeDefined()
    expect(stats).toEqual(
      expect.objectContaining({
        successfulOptimizations: expect.any(Number),
        failedOptimizations: expect.any(Number),
        nodesExamined: expect.any(Number),
        sectionAttempts: expect.any(Number),
        sectionScores: expect.any(Object),
        initialBoardScore: expect.any(Number),
        currentBoardScore: expect.any(Number),
        errors: expect.any(Number),
      }),
    )
    expect(stats?.sectionAttempts).toBe(stats?.nodesExamined)
    expect(
      (stats?.successfulOptimizations as number) +
        (stats?.failedOptimizations as number),
    ).toBe(stats?.sectionAttempts as number)
    expect(stats?.initialBoardScore).toBeLessThanOrEqual(0)
    expect(stats?.currentBoardScore).toBeLessThanOrEqual(0)
    expect(
      Object.keys((stats?.sectionScores as Record<string, number>) ?? {}),
    ).toHaveLength(stats?.successfulOptimizations as number)

    if ("lastSectionScore" in (stats ?? {})) {
      expect(stats?.lastSectionScore).toEqual(expect.any(Number))
    }
    if ("lastBoardScore" in (stats ?? {})) {
      expect(stats?.lastBoardScore).toEqual(expect.any(Number))
    }
  },
  { timeout: 120_000 },
)
