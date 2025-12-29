import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e3 from "fixtures/legacy/assets/e2e3.json" with { type: "json" }

test("should solve e2e3 board and produce valid SimpleRouteJson output", async () => {
  const simpleSrj: SimpleRouteJson = e2e3 as any

  const solver = new AutoroutingPipelineSolver(simpleSrj)
  solver.solve()

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 20_000)
