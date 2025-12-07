import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../../fixtures/getLastStepSvg"
import { simpleRouteJson } from "../../../examples/features/multilayerconnectionpoints/multilayerconnectionpoints01.fixture"

test("routes multilayer connection point with mixed layer obstacles", () => {
  const solver = new AutoroutingPipelineSolver(
    simpleRouteJson as SimpleRouteJson,
  )
  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})

test("should have no vias when MLCP can reach single-layer target on matching layer", () => {
  const solver = new AutoroutingPipelineSolver(
    simpleRouteJson as SimpleRouteJson,
  )
  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  const traces = output.traces ?? []

  // Count all vias across all traces
  let viaCount = 0
  for (const trace of traces) {
    if (trace.type === "pcb_trace") {
      for (const segment of trace.route) {
        if (segment.route_type === "via") {
          viaCount++
        }
      }
    }
  }

  // With proper MLCP layer optimization, there should be no vias
  // since the multi-layer start can pick the same layer as the single-layer end
  expect(viaCount).toBe(0)
})
