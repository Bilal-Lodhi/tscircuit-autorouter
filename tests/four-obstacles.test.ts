import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"
import simpleRouteJson from "./fixtures/four-obstacles/four-obstacles.srj.json"

test("four obstacles - A and D routed with B and C as assignable obstacles", () => {
  const solver = new AutoroutingPipelineSolver(simpleRouteJson as any)

  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path
  )
})
