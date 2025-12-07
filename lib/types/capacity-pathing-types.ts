import type { CapacityMeshNodeId } from "./capacity-mesh-types"

export type CapacityPathId = string

export interface CapacityPath {
  capacityPathId: CapacityPathId
  connectionName: string
  nodeIds: CapacityMeshNodeId[]
  /** True if this path was created by splitting at an offboard edge */
  isFragmentedPath?: boolean
  /** MST pair connection name before fragmentation */
  mstPairConnectionName?: string
  /** Chosen z-layer for the start point (for multi-layer connection points) */
  startZ?: number
  /** Chosen z-layer for the end point (for multi-layer connection points) */
  endZ?: number
}
