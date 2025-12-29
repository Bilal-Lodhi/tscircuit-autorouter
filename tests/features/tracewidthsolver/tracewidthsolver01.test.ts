import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import input from "../../../examples/features/tracewidthsolver/tracewidthsolver01-input.json"

test("TraceWidthSolver - determines optimal trace width based on clearance", () => {
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
