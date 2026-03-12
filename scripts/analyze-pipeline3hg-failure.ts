#!/usr/bin/env bun

import * as dataset from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { getIntraNodeCrossingsUsingCircle } from "../lib/utils/getIntraNodeCrossingsUsingCircle"
import { calculateNodeProbabilityOfFailure } from "../lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"

const args = process.argv.slice(2)
const scenarioName = args[0] ?? "circuit100"

const srj = (dataset as Record<string, any>)[scenarioName]
if (!srj) {
  console.error(
    `Scenario \"${scenarioName}\" not found in @tscircuit/autorouting-dataset-01`,
  )
  process.exit(1)
}

const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj)
solver.solve()

const highDensitySolver = solver.highDensityRouteSolver as any
const failedSolvers = (highDensitySolver?.failedSolvers ?? []) as Array<any>

console.log(`Scenario: ${scenarioName}`)
console.log(
  `Pipeline solved=${solver.solved} failed=${solver.failed} phase=${solver.getCurrentPhase()} time=${solver.timeToSolve}ms`,
)

if (failedSolvers.length === 0) {
  console.log("No failed nodes detected in HighDensitySolver.")
  process.exit(0)
}

const analyzed = failedSolvers.map((failedSolver) => {
  const node = failedSolver.nodeWithPortPoints
  const crossings = getIntraNodeCrossingsUsingCircle(node)
  const pf = calculateNodeProbabilityOfFailure(
    node,
    crossings.numSameLayerCrossings,
    crossings.numEntryExitLayerChanges,
    crossings.numTransitionPairCrossings,
  )

  return {
    nodeId: node.capacityMeshNodeId,
    numPortPoints: node.portPoints.length,
    sameLayerCrossings: crossings.numSameLayerCrossings,
    entryExitLayerChanges: crossings.numEntryExitLayerChanges,
    transitionPairCrossings: crossings.numTransitionPairCrossings,
    estimatedPf: pf,
    error: failedSolver.error,
  }
})

analyzed.sort((a, b) => b.estimatedPf - a.estimatedPf)

console.log(`Failed nodes: ${analyzed.length}`)
for (const node of analyzed) {
  console.log("-")
  console.log(`  node=${node.nodeId}`)
  console.log(`  estimatedPf=${node.estimatedPf.toFixed(3)}`)
  console.log(`  portPoints=${node.numPortPoints}`)
  console.log(
    `  crossings(sameLayer=${node.sameLayerCrossings}, entryExitLayerChanges=${node.entryExitLayerChanges}, transitionPair=${node.transitionPairCrossings})`,
  )
  console.log(`  error=${node.error}`)
}

const worst = analyzed[0]
console.log("\nSuggested plan:")
console.log(
  `1) Prioritize node ${worst.nodeId} (highest estimated failure probability ${worst.estimatedPf.toFixed(3)}).`,
)
console.log(
  "2) Increase Pipeline3 HG effort (e.g. new AutoroutingPipelineSolver3_HgPortPointPathing(srj, { effort: 2 })) to raise high-density solver iteration budgets.",
)
console.log(
  "3) If failures mention via-limit exhaustion, increase the max-via allowance in the MultiHead solver/ViaPossibilities path for high-Pf nodes.",
)
console.log(
  "4) Re-run this script and confirm reduced failed-node count and lower worst-node estimatedPf.",
)
