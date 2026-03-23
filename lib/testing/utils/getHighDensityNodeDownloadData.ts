const findNodeById = (nodes: Array<any> | undefined, nodeId: string) =>
  nodes?.find((node) => node?.capacityMeshNodeId === nodeId) ?? null

export const getHighDensityNodeDownloadData = (
  solver: any,
  nodeId: string,
) => {
  const capacityMeshNode =
    findNodeById(solver.nodeTargetMerger?.newNodes, nodeId) ??
    findNodeById(solver.nodeSolver?.finishedNodes, nodeId) ??
    findNodeById(solver.nodeSolver?.getOutput?.().meshNodes, nodeId) ??
    findNodeById(solver.capacityNodes, nodeId)

  const portPointPathingOutput = solver.portPointPathingSolver?.getOutput?.()

  const nodeWithPortPoints =
    findNodeById(solver.uniformPortDistributionSolver?.getOutput?.(), nodeId) ??
    findNodeById(
      solver.multiSectionPortPointOptimizer?.getNodesWithPortPoints?.(),
      nodeId,
    ) ??
    findNodeById(
      solver.segmentToPointOptimizer?.getNodesWithPortPoints?.(),
      nodeId,
    ) ??
    findNodeById(
      solver.unravelMultiSectionSolver?.getNodesWithPortPoints?.(),
      nodeId,
    ) ??
    findNodeById(
      solver.portPointPathingSolver?.getNodesWithPortPoints?.(),
      nodeId,
    ) ??
    findNodeById(portPointPathingOutput?.nodesWithPortPoints, nodeId)

  const inputNodeWithPortPoints = findNodeById(
    portPointPathingOutput?.inputNodeWithPortPoints,
    nodeId,
  )

  return {
    nodeId,
    capacityMeshNode,
    nodeWithPortPoints,
    inputNodeWithPortPoints,
  }
}
