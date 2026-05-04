import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import cn62169 from "fixtures/legacy/assets/cn62169-nodeWithPortPoints.json" with {
  type: "json",
}
import "graphics-debug/matcher"

test("hdpolyline06", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: cn62169.nodeWithPortPoints,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
