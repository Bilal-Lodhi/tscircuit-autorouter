import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"

/** Populates node adjacency and normal edge port mappings. */
export const buildAdjacency = (
  solver: PortPointReachability2HopCheckSolver,
): void => {
  for (const node of solver.inputNodes) {
    solver.adjacencyByNodeId.set(node.capacityMeshNodeId, new Set())
  }

  for (const port of solver.graph.ports) {
    const nodeId1 = port.region1.regionId
    const nodeId2 = port.region2.regionId
    const edgeKey = solver.getEdgeKey(nodeId1, nodeId2)
    const normalPortIds = solver.normalPortIdsByEdgeKey.get(edgeKey) ?? []
    normalPortIds.push(port.portId)
    solver.normalPortIdsByEdgeKey.set(edgeKey, normalPortIds)
    solver.adjacencyByNodeId.get(nodeId1)?.add(nodeId2)
    solver.adjacencyByNodeId.get(nodeId2)?.add(nodeId1)
  }

  for (const edgeKey of solver.crammedPortPointsByEdgeKey.keys()) {
    const [nodeId1, nodeId2] = edgeKey.split("__")
    solver.adjacencyByNodeId.get(nodeId1)?.add(nodeId2)
    solver.adjacencyByNodeId.get(nodeId2)?.add(nodeId1)
  }
}
