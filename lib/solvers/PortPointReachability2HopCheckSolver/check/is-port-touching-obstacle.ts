import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"

/** Checks whether a port is attached to an obstacle-containing node. */
export const isPortTouchingObstacle = ({
  solver,
  portId,
}: {
  solver: PortPointReachability2HopCheckSolver
  portId: string
}): boolean => {
  const port = solver.graph.ports.find((p) => p.portId === portId)
  let nodeId1: string | null = null
  let nodeId2: string | null = null

  if (port) {
    nodeId1 = port.region1.regionId
    nodeId2 = port.region2.regionId
  } else {
    const crammedPort = solver.crammedPortPointMap.get(portId)
    if (!crammedPort) return false
    nodeId1 = crammedPort.nodeIds[0]
    nodeId2 = crammedPort.nodeIds[1]
  }

  const node1 = solver.inputNodes.find((n) => n.capacityMeshNodeId === nodeId1)
  const node2 = solver.inputNodes.find((n) => n.capacityMeshNodeId === nodeId2)
  return Boolean(node1?._containsObstacle || node2?._containsObstacle)
}
