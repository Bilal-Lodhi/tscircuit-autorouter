import { beforeAll, describe, expect, test } from "bun:test"
import { CapacityMeshSolver } from "lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import bugReport from "../../examples/bug-reports/bugreport10-b2de3c/bugreport10-b2de3c.json" assert { type: "json" }
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

describe("bug report bugreport10-b2de3c", () => {
  let solver: CapacityMeshSolver
  let circuitJson: ReturnType<typeof convertToCircuitJson>
  let pcbSvg: string

  beforeAll(() => {
    solver = new CapacityMeshSolver(srj)
    solver.solve()

    if (solver.failed || !solver.solved) {
      throw new Error(`Solver failed: ${solver.error ?? "unknown"}`)
    }

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Solver did not produce point pairs SRJ")
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()

    const hdRoutes = solver._getOutputHdRoutes()
    const viaDiameter = hdRoutes[0]?.viaDiameter ?? 0.3
    circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      srj.minTraceWidth,
      viaDiameter,
    )

    pcbSvg = convertCircuitJsonToPcbSvg(circuitJson)
  })

  test("matches expected PCB snapshot", () => {
    expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
  })

  test("produces routes without DRC violations", () => {
    const errors = checkEachPcbTraceNonOverlapping(circuitJson)
    expect(errors).toHaveLength(0)
  })
})
