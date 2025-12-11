import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../../lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import bugreport23 from "../../examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json"

test("bugreport23 - should not fail with null z property in port points", async () => {
  const solver = new AutoroutingPipelineSolver(
    bugreport23 as unknown as SimpleRouteJson,
  )

  // Run until we reach the highDensityRouteSolver phase
  // This validates that port points are generated correctly without null values
  while (!solver.failed && !solver.solved) {
    solver.step()
    if (solver.getCurrentPhase() === "highDensityRouteSolver") {
      // Check that all port points have valid pairs (2 per connection per node)
      const nodePortPoints =
        solver.portPointPathingSolver?.getNodesWithPortPoints() ?? []

      let hasInvalidPortPoints = false
      for (const npp of nodePortPoints) {
        // Group by connection name
        const connCounts = new Map<string, number>()
        for (const pp of npp.portPoints) {
          connCounts.set(
            pp.connectionName,
            (connCounts.get(pp.connectionName) ?? 0) + 1,
          )
        }
        // Check for connections with != 2 port points
        for (const [connName, count] of connCounts) {
          if (count !== 2) {
            hasInvalidPortPoints = true
          }
        }
      }

      // The key assertion: all connections should have exactly 2 port points per node
      expect(hasInvalidPortPoints).toBe(false)
      break
    }
  }

  // The solver should have reached the highDensityRouteSolver phase without error
  expect(solver.getCurrentPhase()).toBe("highDensityRouteSolver")
})
