import type { CapacityMeshNodeId, Obstacle } from "lib/types"

export type Phase =
  | "select_obstacle"
  | "associate_targets"
  | "bfs_degree_0"
  | "bfs_degree_1"
  | "bfs_degree_2"
  | "retry_with_crammed"
  | "finalize_obstacle"
  | "done"

export interface ObstacleResult {
  obstacleIndex: number
  obstacle: Obstacle
  anchorNodeId: CapacityMeshNodeId | null
  discoveredDepthByNodeId: Map<CapacityMeshNodeId, number>
  discoveredDepthByEdgeKey: Map<string, number>
  chokeBlockedAtDegree2: boolean
  usedCrammedPortPointIds: Set<string>
}
