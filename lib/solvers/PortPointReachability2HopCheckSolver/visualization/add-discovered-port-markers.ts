import type { Point, Rect } from "graphics-debug"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import type { ObstacleResult } from "../types"
import { getDegreeColor } from "./get-degree-color"

/** Adds markers for discovered normal and crammed ports. */
export const addDiscoveredPortMarkers = ({
  solver,
  points,
  rects,
  state,
}: {
  solver: PortPointReachability2HopCheckSolver
  points: Point[]
  rects: Rect[]
  state: ObstacleResult
}): void => {
  for (const degree of [0, 1, 2] as const) {
    const discoveredPortIds = solver.discoveredPortIdsByDegree.get(degree)
    if (!discoveredPortIds) continue

    const color = getDegreeColor(degree)
    for (const portId of discoveredPortIds) {
      const graphPort = solver.graph.ports.find((p) => p.portId === portId)
      const graphPortPoint = graphPort ? (graphPort as any).d : null
      const crammedPortPoint = solver.crammedPortPointMap.get(portId)
      const x = graphPortPoint?.x ?? crammedPortPoint?.x
      const y = graphPortPoint?.y ?? crammedPortPoint?.y
      if (typeof x !== "number" || typeof y !== "number") continue

      if (crammedPortPoint) {
        rects.push({
          center: { x, y },
          width: 0.18,
          height: 0.18,
          fill: color,
          stroke: "rgba(0,0,0,0.35)",
          label: [
            `crammed ${portId}`,
            `degree ${degree}`,
            state.usedCrammedPortPointIds.has(portId) ? "used" : "candidate",
          ].join("\n"),
        })
        continue
      }

      points.push({
        x,
        y,
        color,
        label: `hyperedge ${portId}\ndegree ${degree}`,
      })
    }
  }
}
