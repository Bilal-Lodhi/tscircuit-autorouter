import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import srj from "./pcb-trace-should-return-root-connection-name.srj.json"
import { mergeGraphics } from "graphics-debug"
import { getLastStepGraphicsObject } from "tests/fixtures/getLastStepGraphicsObject"

const boardSrj = srj as SimpleRouteJson

test("board#23 trace keeps original connection name", () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(boardSrj)
  solver.solve()

  if (solver.failed) {
    throw new Error(solver.error ?? "solver failed")
  }

  const traces = solver.getOutputSimplifiedPcbTraces()

  expect(traces.length).toBeGreaterThan(0)
  expect(new Set(traces.map((trace) => trace.pcb_trace_id))).toEqual(
    new Set([
      "source_trace_0__source_trace_1_mst0_0",
      "source_trace_0__source_trace_1_mst1_0",
    ]),
  )

  const circuitJson = convertToCircuitJson(
    boardSrj,
    traces,
    boardSrj.minTraceWidth,
    boardSrj.minViaDiameter ?? 0.6,
  )
  const { errors } = getDrcErrors(circuitJson)
  expect(errors.length).toBeGreaterThan(0)
  let mixedErrorVIz = getLastStepGraphicsObject(solver.visualize())
  if (errors.length > 0) {
    mixedErrorVIz = mergeGraphics(mixedErrorVIz, {
      texts: [
        {
          text: "has DRC errors",
          x: 0,
          y: 0,
          fontSize: 1,
          color: "red",
        },
      ],
    })
  }
  let finalviz = mixedErrorVIz
  expect(finalviz).toMatchGraphicsSvg(import.meta.path)
})
