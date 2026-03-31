import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver } from "lib/autorouter-pipelines"
import type { SimpleRouteJson } from "lib/types"

const circuit15 = (dataset01 as Record<string, unknown>)
  .circuit015 as SimpleRouteJson

test(
  "circuit015 rejects illegal same-layer cmn_2 crossing in single-route HD solver",
  () => {
    const solver = new AutoroutingPipelineSolver(circuit15, {
      effort: 4,
    })
    solver.solve()

    const cmn2 =
      solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_2")

    expect(solver.failed).toBe(false)
    expect(cmn2).toBeDefined()
    expect(cmn2?.status).toBe("solved")
    expect(cmn2?.solverType).not.toBe(
      "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost",
    )
  },
  { timeout: 60000 },
)
