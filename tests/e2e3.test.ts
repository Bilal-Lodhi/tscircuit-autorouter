import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import e2e3 from "examples/legacy/assets/e2e3.json"

test("should solve e2e3 board and produce valid SimpleRouteJson output", async () => {
  const simpleSrj: SimpleRouteJson = e2e3 as any

  const solver = new AutoroutingPipelineSolver(simpleSrj)
  solver.solve()

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )

  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("Expected SRJ output with point pairs")
  }
  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const circuitJson = convertToCircuitJson(
    srjWithPointPairs,
    simplifiedTraces,
    simpleSrj.minTraceWidth,
  )
  const { errors } = getDrcErrors(circuitJson)
  expect(errors).toHaveLength(0)
}, 20_000)
