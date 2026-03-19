import { expect, test } from "bun:test"
import * as dataset from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver } from "../lib"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"

test(
  "dataset01 sample id 3 snapshot",
  async () => {
    const scenario = (dataset as any)["circuit003"]
    const solver = new AutoroutingPipelineSolver(scenario)
    solver.solve()
    expect(solver.solved).toBe(true)
    await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 20000 },
)
