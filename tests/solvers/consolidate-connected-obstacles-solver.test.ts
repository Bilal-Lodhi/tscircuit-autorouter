import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { ConsolidateConnectedObstaclesSolver } from "lib/solvers/ConsolidateConnectedObstaclesSolver/ConsolidateConnectedObstaclesSolver"
import type { SimpleRouteJson } from "lib/types"
import cm5ioRoute from "../repro/CM5IO.route.json" with { type: "json" }

const createSyntheticSrj = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: {
    minX: -2,
    maxX: 4,
    minY: -2,
    maxY: 2,
  },
  connections: [
    {
      name: "source_trace_0",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "source_trace_1",
      pointsToConnect: [
        { x: 2, y: 0, layer: "top" },
        { x: 3, y: 0, layer: "top" },
      ],
    },
  ],
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 1,
      connectedTo: ["source_trace_0"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0.55, y: 0 },
      width: 0.5,
      height: 1,
      connectedTo: ["source_trace_0"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: -1, y: 0 },
      width: 0.5,
      height: 1,
      connectedTo: ["source_trace_0"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0.55, y: 0 },
      width: 0.5,
      height: 1,
      connectedTo: ["source_trace_1"],
    },
  ],
})

test("ConsolidateConnectedObstaclesSolver merges nearby same-root rects only", () => {
  const srj = createSyntheticSrj()
  const before = structuredClone(srj)
  const solver = new ConsolidateConnectedObstaclesSolver(srj)

  solver.solve()

  const outputSrj = solver.getOutputSimpleRouteJson()
  expect(outputSrj.obstacles).toHaveLength(3)
  expect(solver.stats.reducedObstacleCount).toBe(1)

  const mergedObstacle = outputSrj.obstacles.find(
    (obstacle) =>
      obstacle.connectedTo.includes("source_trace_0") &&
      Math.abs(obstacle.width - 1.05) < 1e-9,
  )

  expect(mergedObstacle).toBeDefined()
  expect(mergedObstacle?.height).toBeCloseTo(1, 10)
  expect(mergedObstacle?.center.x).toBeCloseTo(0.275, 10)
  expect(srj).toEqual(before)
})

test("Pipeline4 switches to the consolidated SRJ before node solving", () => {
  const solver = new AutoroutingPipelineSolver4(createSyntheticSrj())

  solver.solveUntilPhase("nodeSolver")

  expect(solver.consolidateConnectedObstaclesSolver).toBeDefined()
  expect(solver.srjWithConsolidatedObstacles).toBeDefined()
  expect(solver.getWorkingSrj().obstacles).toHaveLength(3)
  expect(
    solver.consolidateConnectedObstaclesSolver?.stats.reducedObstacleCount,
  ).toBe(1)
})

test("ConsolidateConnectedObstaclesSolver consolidates more than ten CM5IO pads", () => {
  const srj = structuredClone(cm5ioRoute) as SimpleRouteJson
  const solver = new ConsolidateConnectedObstaclesSolver(srj)

  solver.solve()

  expect(solver.stats.reducedObstacleCount).toBeGreaterThan(10)
  expect(solver.getOutputSimpleRouteJson().obstacles.length).toBeLessThan(
    srj.obstacles.length - 10,
  )
})
