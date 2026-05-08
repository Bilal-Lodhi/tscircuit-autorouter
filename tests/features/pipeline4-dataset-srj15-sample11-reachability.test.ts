import { expect, test } from "bun:test"
import sample11 from "fixtures/datasets/dataset-srj15/sample11-region-reroute.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

test(
  "pipeline4 dataset-srj15 sample11 fails static reachability precheck before edgesolver fix",
  () => {
    const solver = new AutoroutingPipelineSolver4(
      structuredClone(sample11 as SimpleRouteJson),
      { cacheProvider: null },
    )

    solver.solve()

    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    const errorText = String(solver.error)

    expect(errorText).toContain(
      "Static reachability precheck failed",
    )
    expect(errorText).toContain(
      "source_net_12_reroute_source_net_12_mst0_0_0",
    )
    expect(errorText).toContain(
      "source_net_15_reroute_source_net_15_mst0_0_0__source_net_15_reroute_source_net_15_mst1_0_0_mst1",
    )
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
  },
  120_000,
)
