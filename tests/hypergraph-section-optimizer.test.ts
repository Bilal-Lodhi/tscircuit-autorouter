import { expect, test } from "bun:test"
import { circuit002 } from "@tscircuit/autorouting-dataset-01/lib/dataset"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

const computeSectionPfScore = (
  nodesWithPortPoints: NodeWithPortPoints[],
  capacityNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>,
): number => {
  let totalPf = 0
  for (const nodeWithPortPoints of nodesWithPortPoints) {
    const node = capacityNodeMap.get(nodeWithPortPoints.capacityMeshNodeId)
    if (!node) continue
    if (node._containsTarget) continue
    const crossings = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)
    const pf = calculateNodeProbabilityOfFailure(
      node,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
    totalPf += pf
  }
  return totalPf
}

test(
  "HyperGraphSectionOptimizer improves routing score on e2e2",
  () => {
    const srj = circuit002 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj, {
      effort: 3,
    })

    solver.solveUntilPhase("hyperGraphSectionOptimizer")

    const initialOutput = solver.portPointPathingSolver!.getOutput()
    const initialPathByConnection = new Map(
      solver.portPointPathingSolver!.solvedRoutes.map((route) => [
        route.connection.connectionId,
        route.path,
      ]),
    )
    const capacityNodeMap = new Map(
      solver.capacityNodes!.map((n) => [n.capacityMeshNodeId, n]),
    )
    const initialScore = computeSectionPfScore(
      initialOutput.nodesWithPortPoints,
      capacityNodeMap,
    )
    let lastReportedScore = initialScore
    let stepCount = 0
    const scoreLogInterval = 100

    while (solver.getCurrentPhase() === "hyperGraphSectionOptimizer") {
      solver.step()
      solver.visualize()
      stepCount++
      if (stepCount % scoreLogInterval === 0) {
        const currentOutput = solver.portPointPathingSolver!.getOutput()
        const currentScore = computeSectionPfScore(
          currentOutput.nodesWithPortPoints,
          capacityNodeMap,
        )
        const delta = currentScore - lastReportedScore
        console.log(
          `HyperGraphSectionOptimizer score check #${stepCount}: ${currentScore} (delta ${delta})`,
        )
        if (currentScore < lastReportedScore) {
          lastReportedScore = currentScore
        }
      }
    }

    const optimizedOutput = solver.portPointPathingSolver!.getOutput()
    const optimizedSolvedRoutes = solver.portPointPathingSolver!.solvedRoutes
    const optimizedScore = computeSectionPfScore(
      optimizedOutput.nodesWithPortPoints,
      capacityNodeMap,
    )

    expect(optimizedScore).toBeLessThan(initialScore)
  },
  { timeout: 180_000 },
)
