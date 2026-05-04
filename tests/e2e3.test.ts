import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib/index"
import { SimpleRouteJson } from "../lib/types/index"
import { convertSrjToGraphicsObject } from "../lib/index"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"

test("should solve e2e3 board and produce valid SimpleRouteJson output", async () => {
  const simpleSrj = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver(simpleSrj)
  solver.solve()

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
