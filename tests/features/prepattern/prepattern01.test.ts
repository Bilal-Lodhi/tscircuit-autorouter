import { test, expect } from "bun:test"
import { JumperPrepatternSolver } from "lib/solvers/JumperPrepatternSolver"
import input from "../../../fixtures/jumper-prepattern/prepattern01-input.json" with {
  type: "json",
}

test("JumperPrepatternSolver01 - solves prepattern routes", () => {
  const solver = new JumperPrepatternSolver({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    hyperParameters: input.hyperParameters as any,
    traceWidth: input.traceWidth,
  })

  solver.solve()

  if (!solver.solved) {
    console.log("solver.error:", solver.error)
    console.log("portPointPathingSolver.error:", solver.portPointPathingSolver?.error)
  }

  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
