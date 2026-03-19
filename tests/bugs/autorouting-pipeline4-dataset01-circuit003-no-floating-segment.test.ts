import { expect, test } from "bun:test"
import { circuit003 } from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver4"

const approxEqual = (a: number, b: number, epsilon = 1e-6) =>
  Math.abs(a - b) <= epsilon

test(
  "AutoroutingPipelineSolver4 does not emit the floating source_net_7_mst3 fragment inside circuit003 cmn_4",
  () => {
    const solver = new AutoroutingPipelineSolver4(circuit003 as any, {
      effort: 1,
    })

    let steps = 0
    while (
      !solver.failed &&
      !solver.highDensityRouteSolver &&
      steps < 120_000
    ) {
      solver.step()
      if (solver.hyperGraphSectionOptimizer) {
        solver.hyperGraphSectionOptimizer.config.maxSectionAttempts = 1
      }
      steps += 1
    }

    expect(solver.failed).toBe(false)
    expect(solver.highDensityRouteSolver).toBeDefined()

    const highDensitySolver = solver.highDensityRouteSolver!
    expect(
      highDensitySolver.unsolvedNodePortPoints.some(
        (node) => node.capacityMeshNodeId === "cmn_18",
      ),
    ).toBe(false)

    let highDensitySteps = 0
    while (
      !solver.failed &&
      solver.getCurrentPhase() === "highDensityRouteSolver" &&
      highDensitySteps < 20_000
    ) {
      solver.step()
      highDensitySteps += 1
    }

    expect(solver.failed).toBe(false)
    expect(solver.getCurrentPhase()).toBe("highDensityStitchSolver")

    const floatingRoute = highDensitySolver.routes.find((route) => {
      if (route.connectionName !== "source_net_7_mst3") {
        return false
      }

      const firstPoint = route.route[0]
      const lastPoint = route.route[route.route.length - 1]
      if (!firstPoint || !lastPoint) {
        return false
      }

      const matchesEndpointPair =
        approxEqual(firstPoint.x, -4.064) &&
        approxEqual(lastPoint.x, -4.064) &&
        ((approxEqual(firstPoint.y, -1.7145) &&
          approxEqual(lastPoint.y, -3.3655)) ||
          (approxEqual(firstPoint.y, -3.3655) &&
            approxEqual(lastPoint.y, -1.7145)))

      if (!matchesEndpointPair) {
        return false
      }

      return route.route.every(
        (point) =>
          approxEqual(point.x, -4.064) &&
          point.y <= -1.7145 + 1e-6 &&
          point.y >= -3.3655 - 1e-6,
      )
    })

    expect(floatingRoute).toBeUndefined()
  },
  { timeout: 120_000 },
)
