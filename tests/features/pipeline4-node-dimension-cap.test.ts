import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"

test("pipeline4 subdivides oversized capacity nodes above 8mm before edge generation", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    (dataset01 as Record<string, unknown>).circuit011 as any,
  )

  pipeline.solveUntilPhase("edgeSolver")

  expect(pipeline.capacityNodes).toBeDefined()
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeLessThanOrEqual(8)

  expect(
    (pipeline.capacityNodes ?? []).some(
      (node) => node.capacityMeshNodeId === "cmn_0__sub_0_0",
    ),
  ).toBe(true)

  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeDimension).toBe(
    8,
  )
})
