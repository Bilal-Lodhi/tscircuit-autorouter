import type { CapacityMeshNode, CapacityMeshNodeId } from "../../types"
import type { NodeWithPortPoints, PortPoint } from "../../types/high-density-types"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"

/**
 * Computes a log-based score for a section of nodes with port points.
 * Uses the same algorithm as UnravelSectionSolver.computeG.
 *
 * The score is the log probability of failure across all nodes.
 * Lower (more negative) scores are better.
 *
 * @param nodesWithPortPoints - Nodes in the section with their assigned port points
 * @param capacityMeshNodeMap - Map from node ID to capacity mesh node for Pf calculation
 * @returns Log probability of failure (lower is better)
 */
export function computeSectionScore(
  nodesWithPortPoints: NodeWithPortPoints[],
  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>,
): number {
  /**
   * Numerically stable computation of log(1 - exp(x)).
   * Uses expm1 for better accuracy when x is close to 0.
   */
  function log1mexp(x: number): number {
    if (x < -Math.LN2) return Math.log(1 - Math.exp(x))
    return Math.log(-Math.expm1(x))
  }

  let logSuccess = 0 // log(probability all nodes succeed)

  for (const nodeWithPortPoints of nodesWithPortPoints) {
    const node = capacityMeshNodeMap.get(nodeWithPortPoints.capacityMeshNodeId)
    if (!node) continue

    // Skip target nodes (they don't contribute to failure)
    if (node._containsTarget) continue

    // Compute crossings for this node
    const crossings = getIntraNodeCrossings(nodeWithPortPoints)

    // Compute probability of failure
    const estPf = Math.min(
      calculateNodeProbabilityOfFailure(
        node,
        crossings.numSameLayerCrossings,
        crossings.numEntryExitLayerChanges,
        crossings.numTransitionPairCrossings,
      ),
      0.999999,
    )

    // Add log(1 - Pf) to logSuccess
    // In log space, multiplying probabilities = adding logs
    const log1mPf = Math.log(1 - estPf)
    logSuccess += log1mPf
  }

  // Convert back to log probability of failure
  const logPf = log1mexp(logSuccess)

  return logPf
}

/**
 * Computes the probability of failure for a single node based on its port points.
 * Useful for finding the highest Pf node.
 *
 * @param nodeWithPortPoints - The node with assigned port points
 * @param capacityMeshNode - The capacity mesh node
 * @returns Probability of failure (0-1, higher is worse)
 */
export function computeNodePf(
  nodeWithPortPoints: NodeWithPortPoints,
  capacityMeshNode: CapacityMeshNode,
): number {
  if (capacityMeshNode._containsTarget) return 0

  const crossings = getIntraNodeCrossings(nodeWithPortPoints)

  return calculateNodeProbabilityOfFailure(
    capacityMeshNode,
    crossings.numSameLayerCrossings,
    crossings.numEntryExitLayerChanges,
    crossings.numTransitionPairCrossings,
  )
}
