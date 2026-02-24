import { GraphicsObject } from "graphics-debug"
import { TypedHyperGraph } from "../types"

export const visualizeTypedHyperGraph = (graph: TypedHyperGraph) => {
  let graphics: GraphicsObject = {
    rects: [],
    points: [],
  }

  for (const region of graph.regions) {
    graphics.rects?.push({
      ...region.d,
      fill: region.d._containsObstacle
        ? "rgba(255, 0, 0, 0.25)"
        : "rgba(120, 120, 120, 0.12)",
      layer: `availableZ=${region.d.availableZ}`,
      label: `${region.regionId}`,
    })
  }

  for (const port of graph.ports) {
    if (port.d.cramped) {
      graphics.rects?.push({
        ...port.d,
        center: {
          x: port.d.x,
          y: port.d.y,
        },
        height: 0.1,
        width: 0.1,
        fill: "rgba(255, 140, 0, 0.9)",
        layer: `availableZ=${port.d.availableZ}`,
        label: `${port.portId}`,
      })
    } else {
      graphics.points?.push({
        ...port.d,
        layer: `availableZ=${port.d.availableZ}`,
        label: `${port.portId}`,
        color: "rgba(0, 160, 0, 0.9)",
      })
    }
  }

  return graphics
}
