import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../../lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json"
import { convertSrjToGraphicsObject } from "lib/index"
import { stackGraphicsVertically } from "graphics-debug"

test("bugreport23 - should not fail with null z property in port points", async () => {
  const solver = new AutoroutingPipelineSolver(
    bugreport23 as unknown as SimpleRouteJson,
  )

  solver.solveUntilPhase("multiSectionPortPointOptimizer")
  solver.step()
  // Print the board score after each activeSubSolver finishes
  const msppo = solver.multiSectionPortPointOptimizer
  const ogViz = structuredClone(solver.portPointPathingSolver!.visualize())
  console.log(msppo?.computeBoardScore())
  while (solver.getCurrentPhase() !== "highDensityRouteSolver") {
    solver.step()
    if (msppo?.activeSubSolver) {
      msppo.activeSubSolver.solve()
      solver.step()
      console.log(msppo.sectionAttempts, msppo.stats.currentBoardScore)
    }
  }

  console.log(solver.multiSectionPortPointOptimizer?.stats)

  // -16.821964493704193 is best score seen so far
  expect(
    stackGraphicsVertically([
      ogViz,
      solver.portPointPathingSolver!.visualize(),
    ]),
  ).toMatchGraphicsSvg(`${import.meta.path}-portPointPathingSolver`)
})
