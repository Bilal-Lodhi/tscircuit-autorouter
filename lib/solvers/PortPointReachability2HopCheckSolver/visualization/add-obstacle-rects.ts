import type { Rect } from "graphics-debug"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import type { ObstacleResult } from "../types"

/** Adds obstacle rectangles and marks the active obstacle. */
export const addObstacleRects = ({
  solver,
  rects,
  state,
}: {
  solver: PortPointReachability2HopCheckSolver
  rects: Rect[]
  state: ObstacleResult | null
}): void => {
  for (let i = 0; i < solver.srj.obstacles.length; i++) {
    const obstacle = solver.srj.obstacles[i]
    const isActive = state?.obstacleIndex === i

    rects.push({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      fill: isActive ? "rgba(255, 180, 0, 0.20)" : "rgba(255, 0, 0, 0.08)",
      stroke: isActive ? "rgba(255, 140, 0, 0.95)" : "rgba(255, 0, 0, 0.2)",
      label: `obstacle ${i}${isActive ? " (active)" : ""}`,
    })
  }
}
