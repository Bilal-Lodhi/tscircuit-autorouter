import type { Rect } from "graphics-debug"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import type { ObstacleResult } from "../types"

/** Annotates the active obstacle with live traversal details. */
export const addActiveObstacleDetail = ({
  solver,
  rects,
  state,
}: {
  solver: PortPointReachability2HopCheckSolver
  rects: Rect[]
  state: ObstacleResult
}): void => {
  const activeRect = rects.find((r) => r.label?.includes("(active)"))
  if (!activeRect) return

  activeRect.label = [
    activeRect.label,
    `chokeBlocked@2: ${state.chokeBlockedAtDegree2 ? "yes" : "no"}`,
    `usingCrammed: ${solver.activeObstacleUsesCrammed ? "yes" : "no"}`,
    `frontier: ${solver.frontier.length} (cursor ${solver.frontierCursor})`,
    solver.lastExpansion
      ? `last: d${solver.lastExpansion.degree} ${solver.lastExpansion.fromNodeId}->${solver.lastExpansion.toNodeId}`
      : "last: none",
  ].join("\n")
}
