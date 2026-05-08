import { expect, test } from "bun:test"
import sample11 from "fixtures/datasets/dataset-srj15/sample11-region-reroute.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

test(
  "pipeline4 dataset-srj15 sample11 solves after relaxed same-layer region adjacency",
  () => {
    const solver = new AutoroutingPipelineSolver4(
      structuredClone(sample11 as SimpleRouteJson),
      { cacheProvider: null },
    )

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.error).toBeNull()
    expect(
      (solver.capacityEdges ?? []).some(
        (edge) =>
          edge.nodeIds.includes("cmn_64") &&
          edge.nodeIds.includes("new-cmn_4-36__sub_0_3"),
      ),
    ).toBe(true)
    expect(
      (solver.capacityEdges ?? []).some(
        (edge) =>
          edge.nodeIds.includes("cmn_64") &&
          edge.nodeIds.includes("new-cmn_4-36__sub_0_4"),
      ),
    ).toBe(true)
    expect(
      (solver.capacityEdges ?? []).some(
        (edge) =>
          edge.nodeIds.includes("cmn_56") &&
          edge.nodeIds.includes("new-cmn_4-37__sub_0_2"),
      ),
    ).toBe(true)
    expect(
      (solver.capacityEdges ?? []).some(
        (edge) =>
          edge.nodeIds.includes("cmn_77") &&
          edge.nodeIds.includes("new-cmn_4-36__sub_0_2"),
      ),
    ).toBe(true)
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
  },
  120_000,
)
