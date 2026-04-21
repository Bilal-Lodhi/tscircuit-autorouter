import { expect, test } from "bun:test"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import cmn39NodeWithPortPoints from "../fixtures/cmn_39-node-with-port-points.json" with {
  type: "json",
}

const createHyperSolver = (
  opts: Partial<
    ConstructorParameters<typeof HyperSingleIntraNodeSolver>[0]
  > = {},
) =>
  new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: cmn39NodeWithPortPoints,
    ...opts,
  })

test("HighDensitySolverA08 candidate uses package geometry defaults and copies A01 maxCellCount for cmn_39", () => {
  const hyperSolver = createHyperSolver({ effort: 3 })
  const a01Solver = hyperSolver.generateSolver({
    HIGH_DENSITY_A01: true,
  } as any) as any
  const a08Solver = hyperSolver.generateSolver({
    HIGH_DENSITY_A08: true,
  } as any) as any

  const a01Params = a01Solver.getConstructorParams()[0]
  const a08Params = a08Solver.getConstructorParams()[0]
  const expectedMaxCellCount =
    cmn39NodeWithPortPoints.availableZ.length *
    Math.floor(cmn39NodeWithPortPoints.height / 0.1) *
    Math.floor(cmn39NodeWithPortPoints.width / 0.1)

  expect(a08Solver.constructor.name).toBe("HighDensitySolverA08")
  expect(a08Params.maxCellCount).toBe(a01Params.maxCellCount)
  expect(a08Params.maxCellCount).toBe(expectedMaxCellCount)
  expect(a08Params.traceMargin).toBe(0.15)
  expect(a08Params.traceThickness).toBe(0.1)
  expect(a08Params.effort).toBe(3)
  expect(a08Params.breakoutTraceMarginMm).toBe(0.1)
  expect(a08Params.breakoutSegmentCount).toBe(2)
  expect(a08Params.breakoutMaxIterationsPerRect).toBe(60)
  expect(a08Params.initialRectMarginMm).toBe(0.2)
})

test("HyperSingleIntraNodeSolver solves cmn_39 with the A08 candidate", () => {
  const solver = createHyperSolver()

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.winningSolver?.constructor.name).toBe("HighDensitySolverA08")
  expect(solver.solvedRoutes).toHaveLength(8)
})
