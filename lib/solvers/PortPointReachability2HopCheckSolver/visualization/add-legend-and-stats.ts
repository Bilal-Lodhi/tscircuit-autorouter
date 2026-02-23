import type { Rect } from "graphics-debug"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import {
  DEGREE_0_COLOR,
  DEGREE_1_COLOR,
  DEGREE_2_COLOR,
} from "../constants/colors"

/** Adds legend swatches and solver status panel. */
export const addLegendAndStats = ({
  solver,
  rects,
}: {
  solver: PortPointReachability2HopCheckSolver
  rects: Rect[]
}): void => {
  rects.push(
    {
      center: {
        x: solver.srj.bounds.minX + 0.7,
        y: solver.srj.bounds.minY + 0.7,
      },
      width: 0.5,
      height: 0.5,
      fill: DEGREE_0_COLOR,
      label: "Degree 0 hyperedge",
    },
    {
      center: {
        x: solver.srj.bounds.minX + 0.7,
        y: solver.srj.bounds.minY + 1.4,
      },
      width: 0.5,
      height: 0.5,
      fill: DEGREE_1_COLOR,
      label: "Degree 1 hyperedge",
    },
    {
      center: {
        x: solver.srj.bounds.minX + 0.7,
        y: solver.srj.bounds.minY + 2.1,
      },
      width: 0.5,
      height: 0.5,
      fill: DEGREE_2_COLOR,
      label: "Degree 2 hyperedge",
    },
    {
      center: {
        x: solver.srj.bounds.minX + 1.8,
        y: solver.srj.bounds.minY + 1.9,
      },
      width: 2.0,
      height: 3.0,
      fill: "rgba(255,255,255,0.03)",
      stroke: "rgba(255,255,255,0.2)",
      label: [
        `phase: ${solver.phase}`,
        `obstacle: ${Math.min(solver.currentObstacleIndex, solver.srj.obstacles.length)}/${solver.srj.obstacles.length}`,
        `used crammed total: ${solver.usedCrammedPortPointIds.size}`,
      ].join("\n"),
    },
  )
}
