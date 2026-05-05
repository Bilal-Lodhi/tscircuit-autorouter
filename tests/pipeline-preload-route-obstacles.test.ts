import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import datasetSrj14Sample01 from "../fixtures/datasets/dataset-srj14/sample01-source_net_5_mst1_0.srj.json" with {
  type: "json",
}

const srjWithPreloadedRoute: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  bounds: { minX: -1, minY: -1, maxX: 2, maxY: 2 },
  obstacles: [],
  connections: [],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "source_trace_0",
      connection_name: "source_net_0",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.2,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 1,
          y: 1,
          width: 0.2,
          layer: "top",
        },
      ],
    },
  ],
}

const countTraceRouteObstacles = (srj: SimpleRouteJson) => {
  let obstacleCount = 0

  for (const trace of srj.traces ?? []) {
    for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {
      const routePoint = trace.route[pointIndex]!
      const nextRoutePoint = trace.route[pointIndex + 1]

      if (
        routePoint.route_type === "wire" &&
        nextRoutePoint?.route_type === "wire" &&
        routePoint.layer === nextRoutePoint.layer
      ) {
        if (
          Math.hypot(
            nextRoutePoint.x - routePoint.x,
            nextRoutePoint.y - routePoint.y,
          ) > 0.001
        ) {
          obstacleCount++
        }
      } else if (routePoint.route_type === "via") {
        obstacleCount++
      } else if (routePoint.route_type === "through_obstacle") {
        if (
          Math.hypot(
            routePoint.end.x - routePoint.start.x,
            routePoint.end.y - routePoint.start.y,
          ) > 0.001
        ) {
          obstacleCount++
        }
      }
    }
  }

  return obstacleCount
}

test("pipeline4 preloads SRJ traces as route obstacles before approximating rotated obstacles", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithPreloadedRoute)
  const traceObstacles = solver.srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("trace_obstacle_source_trace_0"),
  )

  expect(traceObstacles).toHaveLength(2)
  expect(
    traceObstacles.every(
      (obstacle) =>
        obstacle.layers.length === 1 &&
        obstacle.layers[0] === "top" &&
        obstacle.ccwRotationDegrees === 45,
    ),
  ).toBe(true)
})

test("pipeline6 preloads SRJ traces as rotated route obstacles in the constructor", () => {
  const solver = new AutoroutingPipelineSolver6(srjWithPreloadedRoute)
  const [traceObstacle] = solver.srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("trace_obstacle_source_trace_0"),
  )

  expect(traceObstacle).toBeDefined()
  expect(traceObstacle).toMatchObject({
    type: "rect",
    layers: ["top"],
    center: { x: 0.5, y: 0.5 },
    height: 0.2,
    ccwRotationDegrees: 45,
  })
  expect(traceObstacle!.width).toBeCloseTo(Math.SQRT2)
})

test("pipeline4 and pipeline6 preload dataset-srj14 route obstacles during construction", () => {
  const sample = datasetSrj14Sample01 as SimpleRouteJson
  const expectedTraceObstacleCount = countTraceRouteObstacles(sample)
  const pipeline4Solver = new AutoroutingPipelineSolver4(sample)
  const pipeline6Solver = new AutoroutingPipelineSolver6(sample)

  const pipeline4TraceObstacleCount = pipeline4Solver.srj.obstacles.filter(
    (obstacle) => obstacle.obstacleId?.startsWith("trace_obstacle_"),
  ).length
  const pipeline6TraceObstacleCount = pipeline6Solver.srj.obstacles.filter(
    (obstacle) => obstacle.obstacleId?.startsWith("trace_obstacle_"),
  ).length

  expect(expectedTraceObstacleCount).toBeGreaterThan(0)
  expect(pipeline4TraceObstacleCount).toBeGreaterThanOrEqual(
    expectedTraceObstacleCount,
  )
  expect(pipeline6TraceObstacleCount).toBe(expectedTraceObstacleCount)
})
