import type { Connection, HyperGraph } from "@tscircuit/hypergraph"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { HgRegion } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"
import { buildHyperConnectionsFromSimpleRouteJson } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperConnectionsFromSimpleRouteJson"
import { buildHyperGraphFromInputNodes } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"
import type {
  AvailableSegmentPointSolver,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type SharedEdge = SharedEdgeSegment

export interface HgPortPointPathingSharedInputs {
  inputNodes: InputNodeWithPortPoints[]
  graph: HyperGraph
  regionMap: Map<CapacityMeshNodeId, HgRegion>
  portPointMap: Map<string, InputPortPoint>
  connections: Connection[]
  connectionsWithResults: ConnectionPathResult[]
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>
  sharedEdges: SharedEdge[]
}

/**
 * Build all shared structures needed by both the fast reachability check and
 * the main HgPortPointPathingSolver. This keeps graph-related computation in
 * one place and avoids rebuilding it for each solver step.
 */
export function buildHgPortPointPathingSharedInputs({
  capacityNodes,
  availableSegmentPointSolver,
  simpleRouteJson,
  selectedCrammedPortPointIds,
}: {
  capacityNodes: CapacityMeshNode[]
  availableSegmentPointSolver: AvailableSegmentPointSolver
  simpleRouteJson: SimpleRouteJson
  selectedCrammedPortPointIds?: Set<string>
}): HgPortPointPathingSharedInputs {
  const inputNodes = capacityNodes.map((node) => ({
    capacityMeshNodeId: node.capacityMeshNodeId,
    center: node.center,
    width: node.width,
    height: node.height,
    portPoints: [] as InputPortPoint[],
    availableZ: node.availableZ,
    _containsTarget: node._containsTarget,
    _containsObstacle: node._containsObstacle,
  }))

  const nodeMap = new Map(inputNodes.map((n) => [n.capacityMeshNodeId, n]))

  for (const segment of availableSegmentPointSolver.sharedEdgeSegments) {
    const selectedCrammedPortPoints = segment.crammedPortPoints.filter((pp) =>
      selectedCrammedPortPointIds?.has(pp.segmentPortPointId),
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
      if (node1) {
        node1.portPoints.push(inputPortPoint)
      }
    }
  }

  const { graph, regionMap, portPointMap } = buildHyperGraphFromInputNodes({
    inputNodes,
  })
  const { connections, connectionsWithResults, connectionNameToGoalNodeIds } =
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
    connectionNameToGoalNodeIds,
    sharedEdges: availableSegmentPointSolver.sharedEdgeSegments,
  }
}
