import { GraphicsObject } from "graphics-debug"
import { TypedHyperGraph } from "../types"

export const visualizationTypedHyperGraph = (graph: TypedHyperGraph) => {
  let graphics: GraphicsObject = {
    rects: [],
    points: [],
  }

  for (const region of graph.regions) {
    graphics.rects?.push({
      ...region.d,
      fill: region.d._containsObstacle
        ? "rgb(255, 0, 0, 0.5)"
        : "rgb(0, 0, 255, 0.1)",
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
        height: -0.1,
        width: -0.1,
        fill: "green",
        layer: `availableZ=${port.d.availableZ}`,
        label: `${port.portId}`,
      })
    } else {
      graphics.points?.push({
        ...port.d,
        layer: `availableZ=${port.d.availableZ}`,
        label: `${port.portId}`,
        color: "green",
      })
    }
  }

  return graphics
}
