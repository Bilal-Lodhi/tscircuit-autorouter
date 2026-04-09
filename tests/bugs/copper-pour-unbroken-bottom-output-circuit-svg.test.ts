import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bugs/copper-pour-unbroken-bottom.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver } from "../../lib"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("copper pour SRJ output circuit svg snapshot", async () => {
  const solver = new AutoroutingPipelineSolver(
    structuredClone(srj as SimpleRouteJson),
  )
  solver.solve()

  const svg = getLastStepSvg(solver.visualize())

  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 120_000)
