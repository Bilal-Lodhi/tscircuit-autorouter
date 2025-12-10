import type { CapacityMeshSolver } from "lib/solvers/AutoroutingPipelineSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

export const getNodeDebugData = ({
  solver,
  label,
}: {
  solver: CapacityMeshSolver
  label: string | null | undefined
}): {
  nodeId: string
  nodeData: any
  nodeWithPortPoints: NodeWithPortPoints | null
} | null => {
  if (!label) return null

  const match = label.match(/cn_?(\d+)/) ?? label.match(/cmn_(\d+)/)

  const nodeId = match?.[0]
  if (!nodeId) return null

  let nodeData = null

  if (solver.nodeTargetMerger?.newNodes) {
    nodeData = solver.nodeTargetMerger.newNodes.find(
      (n: any) => n.capacityMeshNodeId === nodeId,
    )
  } else if (solver.nodeSolver && "finishedNodes" in solver.nodeSolver) {
    const finishedNodes = (solver.nodeSolver as any).finishedNodes as
      | Array<any>
      | undefined
    nodeData = finishedNodes?.find((n: any) => n.capacityMeshNodeId === nodeId)
  }

  let nodeWithPortPoints: NodeWithPortPoints | null = null
  if (solver.unravelMultiSectionSolver?.getNodesWithPortPoints) {
    nodeWithPortPoints =
      solver
        .unravelMultiSectionSolver!.getNodesWithPortPoints()
        .find((n) => n.capacityMeshNodeId === nodeId) ?? null
  }

  return { nodeId, nodeData, nodeWithPortPoints }
}
