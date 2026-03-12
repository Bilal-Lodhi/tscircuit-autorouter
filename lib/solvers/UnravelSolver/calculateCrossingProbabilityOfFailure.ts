import { CapacityMeshNode } from "lib/types"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

export const calculateNodeProbabilityOfFailure = (
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
  numEntryExitLayerChanges: number,
  numTransitionCrossings: number,
): number => {
  if (node?._containsTarget) return 0

  const numLayers = node.availableZ?.length ?? 2

  if (
    numLayers === 1 &&
    (numSameLayerCrossings > 0 ||
      numEntryExitLayerChanges > 0 ||
      numTransitionCrossings > 0)
  ) {
    return 1
  }

  // Number of traces through the node
  const totalCapacity = getTunedTotalCapacity1(node)
  const safeCapacity = Math.max(totalCapacity, 0.05)

  // Estimated number of vias based on crossings
  const weightedCrossingLoad =
    numSameLayerCrossings * 0.88 +
    numEntryExitLayerChanges * 0.36 +
    numTransitionCrossings * 0.18

  // Higher layer-count nodes can spread crossings, which lowers risk.
  const layerRelief = 1 / (1 + Math.max(0, numLayers - 2) * 0.45)
  const effectiveCrossingLoad = weightedCrossingLoad * layerRelief

  // Convert raw crossing load into a capacity pressure ratio.
  const utilization = effectiveCrossingLoad / (safeCapacity * 2.4)

  // Squash into [0,1] with a soft logistic tail to avoid over-penalizing
  // modest crossing counts on otherwise solvable nodes.
  const logistic = 1 / (1 + Math.exp(-5 * (utilization - 0.64)))

  // Keep a low baseline floor for slight congestion while ensuring hard bounds.
  const calibrated = 0.015 + logistic * 0.83
  return Math.min(1, Math.max(0, calibrated))
}
