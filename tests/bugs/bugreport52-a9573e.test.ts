import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport52-a9573e/bugreport52-a9573e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

const pointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
) =>
  Math.abs(point.x - node.center.x) <= node.width / 2 + 1e-6 &&
  Math.abs(point.y - node.center.y) <= node.height / 2 + 1e-6

test("bugreport52-a9573e.json avoids a via inside multilayer pad cmn_184", () => {
  const solver = new AutoroutingPipelineSolver(srj, { cacheProvider: null })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const cmn184 = solver.highDensityNodePortPoints?.find(
    (node) => node.capacityMeshNodeId === "cmn_184",
  )
  expect(cmn184).toBeDefined()

  const cmn184Metadata =
    solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_184")
  expect(cmn184Metadata?.solverType).toBe(
    "SingleTransitionThroughObstacleIntraNodeSolver",
  )

  const sourceTrace3ViasInCmn184 = (solver.highDensityRouteSolver?.routes ?? [])
    .filter((route) => route.connectionName === "source_trace_3")
    .flatMap((route) => route.vias)
    .filter((via) => pointInsideNode(via, cmn184!))

  expect(sourceTrace3ViasInCmn184).toEqual([])
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 120_000)
