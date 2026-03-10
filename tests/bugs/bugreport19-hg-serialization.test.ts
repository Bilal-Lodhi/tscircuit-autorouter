import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib"
import { serializeHyperGraphSnapshot } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport19/bugreport19.json" with {
  type: "json",
}

const srj = bugReport as SimpleRouteJson

test("bugreport19 hypergraph snapshot is serializable and contains solved paths", () => {
  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj)
  solver.solve()

  expect(solver.hgGraph).toBeDefined()
  expect(solver.hgConnections).toBeDefined()
  expect(solver.portPointPathingSolver?.solvedRoutes.length).toBeGreaterThan(0)

  const snapshot = serializeHyperGraphSnapshot({
    graph: solver.hgGraph!,
    connections: solver.hgConnections!,
    solvedRoutes: solver.portPointPathingSolver!.solvedRoutes as any,
    layerCount: srj.layerCount,
  })

  const roundTripped = JSON.parse(JSON.stringify(snapshot))

  expect(roundTripped.graph.regions.length).toBeGreaterThan(0)
  expect(roundTripped.graph.ports.length).toBeGreaterThan(0)
  expect(roundTripped.solvedRoutes.length).toBeGreaterThan(0)
  expect(roundTripped.layerCount).toBe(srj.layerCount)
  expect(
    roundTripped.solvedRoutes.every((route: any) => route.pointIds.length > 0),
  ).toBe(true)
})
