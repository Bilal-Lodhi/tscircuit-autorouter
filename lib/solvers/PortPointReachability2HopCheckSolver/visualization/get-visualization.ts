import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { addActiveObstacleDetail } from "./add-active-obstacle-detail"
import { addDiscoveredPortMarkers } from "./add-discovered-port-markers"
import { addLegendAndStats } from "./add-legend-and-stats"
import { addObstacleRects } from "./add-obstacle-rects"
import { getVisualState } from "./get-visual-state"

/** Builds visualization primitives for the current solver state. */
export const getVisualization = (
  solver: PortPointReachability2HopCheckSolver,
): GraphicsObject => {
  const lines: Line[] = []
  const points: Point[] = []
  const rects: Rect[] = []
  const state = getVisualState(solver)

  addObstacleRects({ solver, rects, state })

  if (state) {
    addDiscoveredPortMarkers({ solver, points, rects, state })
    addActiveObstacleDetail({ solver, rects, state })
  }

  addLegendAndStats({ solver, rects })

  return { lines, rects, points }
}
