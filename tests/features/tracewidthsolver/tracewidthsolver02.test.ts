import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import input from "../../../fixtures/features/tracewidthsolver/tracewidthsolver02-input.json" with {
  type: "json",
}

test("TraceWidthSolver02 - trace width with jumpers", () => {
  const data = (input as any)[0]

  const solver = new TraceWidthSolver({
    hdRoutes: data.hdRoutes,
    minTraceWidth: data.minTraceWidth,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getHdRoutesWithWidths().length).toBeGreaterThan(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
