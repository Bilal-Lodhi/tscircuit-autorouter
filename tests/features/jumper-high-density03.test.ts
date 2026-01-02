import { test, expect } from "bun:test"
import { HyperIntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/HyperIntraNodeSolverWithJumpers"
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers"
import input from "../../fixtures/features/jumper-high-density/jumper-high-density03-input.json" with {
  type: "json",
}

test("Base IntraNodeSolverWithJumpers - still works", () => {
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    hyperParameters: input.hyperParameters,
    traceWidth: input.traceWidth,
  })

  solver.solve()

  console.log("Base solver.solved:", solver.solved)
  console.log("Base solver.failed:", solver.failed)
  console.log("Base solver.error:", solver.error)

  expect(solver.solved).toBe(true)
})

test("HyperIntraNodeSolverWithJumpers03 - solves high density routes with jumpers", () => {
  const solver = new HyperIntraNodeSolverWithJumpers({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    hyperParameters: input.hyperParameters,
    traceWidth: input.traceWidth,
  })

  solver.solve()

  console.log("solver.solved:", solver.solved)
  console.log("solver.failed:", solver.failed)
  console.log("solver.error:", solver.error)
  console.log("solver.winningSolver:", !!solver.winningSolver)
  console.log("solver.solvedRoutes.length:", solver.solvedRoutes.length)

  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
