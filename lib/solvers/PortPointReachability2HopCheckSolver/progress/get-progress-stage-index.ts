import type { Phase } from "../types"

/** Maps the phase to a per-obstacle stage index. */
export const getProgressStageIndex = (phase: Phase): number => {
  switch (phase) {
    case "select_obstacle":
      return 0
    case "associate_targets":
      return 1
    case "bfs_degree_0":
      return 2
    case "bfs_degree_1":
      return 3
    case "bfs_degree_2":
      return 4
    case "retry_with_crammed":
      return 5
    case "finalize_obstacle":
      return 6
    case "done":
      return 7
  }
}
