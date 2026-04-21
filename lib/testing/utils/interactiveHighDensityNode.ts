import type { NodeWithPortPoints } from "lib/types/high-density-types"

export type InteractiveHighDensitySolveNodeSource = "uploaded" | "edited"

export const cloneNodeWithPortPoints = (
  nodeWithPortPoints: NodeWithPortPoints,
): NodeWithPortPoints => ({
  ...nodeWithPortPoints,
  center: { ...nodeWithPortPoints.center },
  availableZ: nodeWithPortPoints.availableZ
    ? [...nodeWithPortPoints.availableZ]
    : undefined,
  portPoints: nodeWithPortPoints.portPoints.map((portPoint) => ({
    ...portPoint,
  })),
})

export const getInteractiveHighDensitySolveNode = ({
  source,
  uploadedNode,
  editedNode,
}: {
  source: InteractiveHighDensitySolveNodeSource
  uploadedNode: NodeWithPortPoints
  editedNode: NodeWithPortPoints
}) => (source === "uploaded" ? uploadedNode : editedNode)
