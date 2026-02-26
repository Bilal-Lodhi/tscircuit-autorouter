import { CapacityMeshNode } from "lib/types"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

export const calculateNodeProbabilityOfFailure = (
  node: CapacityMeshNode,
  viaDiameter: number,
  numSameLayerCrossings: number,
  numEntryExitLayerChanges: number,
  numTransitionCrossings: number,
): number => {
  if (node?._containsTarget) return 0

  const area = node.width * node.height
  const viaArea = Math.PI * (viaDiameter / 2) ** 2

  if(area < 3){
    const ratio = ((numSameLayerCrossings + numEntryExitLayerChanges + numTransitionCrossings) * viaArea) / area

    if(ratio > 0.7) {
     return 1
    }

  }




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

  // Estimated number of vias based on crossings
  const estNumVias =
    numSameLayerCrossings * 0.82 +
    numEntryExitLayerChanges * 0.41 +
    numTransitionCrossings * 0.2

  const estUsedCapacity = (estNumVias / 2) ** 1.1

  // We could refine this with actual trace capacity
  const approxProb = estUsedCapacity / totalCapacity

  // Bounded probability calculation
  return approxProb
}
