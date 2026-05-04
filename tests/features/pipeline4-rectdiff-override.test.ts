import { expect, test } from "bun:test"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

const injectedMeshNodes: CapacityMeshNode[] = [
  {
    capacityMeshNodeId: "override-node",
    center: { x: 1, y: 1 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0],
  },
]

class FakeRectDiffPipeline extends RectDiffPipeline {
  override _setup() {}

  override _step() {
    this.solved = true
  }

  override getOutput() {
    return { meshNodes: injectedMeshNodes }
  }
}

test("pipeline4 uses the injected RectDiffPipelineClass override", () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(e2e3Fixture as SimpleRouteJson),
    {
      overrides: {
        RectDiffPipelineClass: FakeRectDiffPipeline,
      },
    },
  )

  solver.solveUntilPhase("nodeDimensionSubdivisionSolver")

  expect(solver.nodeSolver).toBeInstanceOf(FakeRectDiffPipeline)
  expect(solver.capacityNodes).toEqual(injectedMeshNodes)
})
