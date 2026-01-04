import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { simpleRouteJson } from "../../../fixtures/features/off-board-obstacles/off-board-assignable.fixture"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"

test("routes with assignable off-board obstacles between pads", () => {
  const solver = new AssignableAutoroutingPipeline2(
    simpleRouteJson as SimpleRouteJson,
  )
  solver.solve()
  const traces = solver.getOutputSimplifiedPcbTraces()
  console.table(
    traces.flatMap((t) =>
      t.route.flatMap((r, ri) => ({
        trace: t.pcb_trace_id,
        rt: r.route_type,
        ri,
        x: r.route_type === "wire" ? r.x.toFixed(2) : undefined,
        y: r.route_type === "wire" ? r.y.toFixed(2) : undefined,
      })),
    ),
  )

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
