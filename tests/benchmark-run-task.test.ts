import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { createSolverForTask } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

const getCircuit102 = () =>
  (dataset01 as Record<string, unknown>).circuit102 as SimpleRouteJson

test("benchmark tasks forward scenario effort into pipeline solver options", () => {
  const task: BenchmarkTask = {
    solverName: "AutoroutingPipelineSolver4",
    scenarioName: "circuit102",
    scenario: {
      ...structuredClone(getCircuit102()),
      effort: 2,
    } as SimpleRouteJson,
  }

  const solver = createSolverForTask(task) as AutoroutingPipelineSolver4

  expect(solver.effort).toBe(2)
})
