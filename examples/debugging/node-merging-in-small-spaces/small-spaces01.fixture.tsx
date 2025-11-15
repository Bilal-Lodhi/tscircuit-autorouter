import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"

const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.2,
  obstacles: [
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -1.8, y: 1.9 },
      width: 0.9,
      height: 0.7,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0.2, y: 1.6 },
      width: 1.1,
      height: 0.6,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 1.7, y: 1.4 },
      width: 0.8,
      height: 0.9,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -1.6, y: 0.2 },
      width: 1,
      height: 0.8,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0.4, y: 0.3 },
      width: 1,
      height: 1.1,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 1.6, y: 0 },
      width: 0.9,
      height: 0.7,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -1.5, y: -1.8 },
      width: 0.9,
      height: 0.7,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0.1, y: -1.5 },
      width: 1.2,
      height: 0.6,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 1.5, y: -1.7 },
      width: 0.8,
      height: 0.8,
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "net-diagonal-top-left-to-bottom-right",
      pointsToConnect: [
        { x: -4.5, y: 4.5, layer: "top" },
        { x: 4.5, y: -4.5, layer: "top" },
      ],
    },
    {
      name: "net-diagonal-bottom-left-to-top-right",
      pointsToConnect: [
        { x: -4.5, y: -4.5, layer: "bottom" },
        { x: 4.5, y: 4.5, layer: "bottom" },
      ],
    },
    {
      name: "net-horizontal-middle",
      pointsToConnect: [
        { x: -4.5, y: 0, layer: "top" },
        { x: 4.5, y: 0.2, layer: "bottom" },
      ],
    },
  ],
  bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
  outline: [
    { x: -5.5, y: 5.5 },
    { x: -5.5, y: -5.5 },
    { x: 5.5, y: -5.5 },
    { x: 5.5, y: 5.5 },
  ],
}

export default () => <AutoroutingPipelineDebugger srj={simpleRouteJson} />
