import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport49-1b2d3e/bugreport49-1b2d3e.json" with {
  type: "json",
}
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport49-1b2d3e routes cleanly and matches the PCB snapshot",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Solver did not produce point pairs SRJ")
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      srj.minTraceWidth,
    )
    const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson)
    const { errors } = getDrcErrors(circuitJson)

    expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
    expect(errors).toHaveLength(0)
  },
  { timeout: 120_000 },
)
