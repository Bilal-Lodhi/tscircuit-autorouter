import type { SimpleRouteJson } from "lib/types"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { HgPortPointPathingSharedInputs } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHgPortPointPathingSharedInputs"
import { buildHyperGraphFromInputNodes } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"
import { buildHyperConnectionsFromSimpleRouteJson } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperConnectionsFromSimpleRouteJson"

/** Builds shared inputs using an existing base and selected crammed port points. */
export function buildHgPortPointPathingSharedInputsFromExisting({
  baseSharedInputs,
  simpleRouteJson,
  selectedCrammedPortPointIds,
}: {
  baseSharedInputs: HgPortPointPathingSharedInputs
  simpleRouteJson: SimpleRouteJson
  selectedCrammedPortPointIds: Set<string>
}): HgPortPointPathingSharedInputs {
  const inputNodes: InputNodeWithPortPoints[] = baseSharedInputs.inputNodes.map(
    (node) => ({
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints: [],
      availableZ: node.availableZ,
      _containsTarget: node._containsTarget,
      _containsObstacle: node._containsObstacle,
    }),
  )

  const nodeMap = new Map(inputNodes.map((n) => [n.capacityMeshNodeId, n]))

  for (const segment of baseSharedInputs.sharedEdges) {
    const selectedCrammedPortPoints = segment.crammedPortPoints.filter((pp) =>
      selectedCrammedPortPointIds.has(pp.segmentPortPointId),
    )
    const segmentPortPoints = [
      ...segment.normalPortPoints,
      ...selectedCrammedPortPoints,
    ]

    for (const segmentPortPoint of segmentPortPoints) {
      const [nodeId1, nodeId2] = segmentPortPoint.nodeIds
      const inputPortPoint: InputPortPoint = {
        portPointId: segmentPortPoint.segmentPortPointId,
        x: segmentPortPoint.x,
        y: segmentPortPoint.y,
        z: segmentPortPoint.availableZ[0] ?? 0,
        connectionNodeIds: [nodeId1, nodeId2],
        distToCentermostPortOnZ: segmentPortPoint.distToCentermostPortOnZ,
      }
      const node1 = nodeMap.get(nodeId1)
      if (node1) node1.portPoints.push(inputPortPoint)
    }
  }

  const { graph, regionMap, portPointMap } = buildHyperGraphFromInputNodes({
    inputNodes,
  })
  const { connections, connectionsWithResults } =
    buildHyperConnectionsFromSimpleRouteJson({
      simpleRouteJson,
      inputNodes,
      regionMap,
    })

  return {
    inputNodes,
    graph,
    regionMap,
    portPointMap,
    connections,
    connectionsWithResults,
    sharedEdges: baseSharedInputs.sharedEdges,
  }
}
