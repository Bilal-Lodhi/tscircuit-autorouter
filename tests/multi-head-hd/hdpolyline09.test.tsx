import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import cn27515 from "fixtures/legacy/assets/cn27515-nodeWithPortPoints.json" with {
  type: "json",
}
import "graphics-debug/matcher"

test.skip("hdpolyline09", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: cn27515.nodeWithPortPoints,
    hyperParameters: {
      SEGMENTS_PER_POLYLINE: 4,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
