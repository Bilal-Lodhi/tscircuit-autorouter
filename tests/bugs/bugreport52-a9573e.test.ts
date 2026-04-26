import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport52-a9573e/bugreport52-a9573e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson
type Obstacle = SimpleRouteJson["obstacles"][number]

const pointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
) =>
  Math.abs(point.x - node.center.x) <= node.width / 2 + 1e-6 &&
  Math.abs(point.y - node.center.y) <= node.height / 2 + 1e-6

const pointInsideObstacle = (
  point: { x: number; y: number },
  obstacle: Obstacle,
) =>
  Math.abs(point.x - obstacle.center.x) <= obstacle.width / 2 + 1e-6 &&
  Math.abs(point.y - obstacle.center.y) <= obstacle.height / 2 + 1e-6

const getObstacleLabel = (obstacle: Obstacle) =>
  obstacle.obstacleId ??
  `${obstacle.type}@${obstacle.center.x.toFixed(3)},${obstacle.center.y.toFixed(3)}`

test("bugreport52-a9573e.json avoids a via inside multilayer pad cmn_184", () => {
  const solver = new AutoroutingPipelineSolver(srj, { cacheProvider: null })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const cmn184 = solver.highDensityNodePortPoints?.find(
    (node) => node.capacityMeshNodeId === "cmn_184",
  )
  expect(cmn184).toBeDefined()

  const cmn184Metadata =
    solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_184")
  expect(cmn184Metadata?.solverType).toBe(
    "SingleTransitionThroughObstacleIntraNodeSolver",
  )

  const sourceTrace3ViasInCmn184 = (solver.highDensityRouteSolver?.routes ?? [])
    .filter((route) => route.connectionName === "source_trace_3")
    .flatMap((route) => route.vias)
    .filter((via) => pointInsideNode(via, cmn184!))

  const sourceTrace3ThroughObstacleSegments = (
    solver.highDensityRouteSolver?.routes ?? []
  )
    .filter((route) => route.connectionName === "source_trace_3")
    .flatMap((route) =>
      route.route.slice(0, -1).flatMap((point, index) => {
        const nextPoint = route.route[index + 1]!
        if (point.toNextSegmentType !== "through_obstacle") return []
        return [{ fromZ: point.z, toZ: nextPoint.z }]
      }),
    )

  expect(sourceTrace3ViasInCmn184).toEqual([])
  expect(sourceTrace3ThroughObstacleSegments).toContainEqual({
    fromZ: 1,
    toZ: 0,
  })

  const highDensityViasInsideObstacles = (
    solver.highDensityRouteSolver?.routes ?? []
  ).flatMap((route) =>
    route.vias.flatMap((via) =>
      srj.obstacles
        .filter((obstacle) => pointInsideObstacle(via, obstacle))
        .map((obstacle) => ({
          source: "high-density",
          connectionName: route.connectionName,
          via,
          obstacle: getObstacleLabel(obstacle),
        })),
    ),
  )

  const outputViasInsideObstacles = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.flatMap((segment) => {
        if (segment.route_type !== "via") return []
        return srj.obstacles
          .filter((obstacle) => pointInsideObstacle(segment, obstacle))
          .map((obstacle) => ({
            source: "simplified",
            traceId: trace.pcb_trace_id,
            connectionName: trace.connection_name,
            via: {
              x: segment.x,
              y: segment.y,
              fromLayer: segment.from_layer,
              toLayer: segment.to_layer,
            },
            obstacle: getObstacleLabel(obstacle),
          }))
      }),
    )

  const throughObstacleSegmentsInsideObstacles = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.flatMap((segment) => {
        if (segment.route_type !== "through_obstacle") return []
        return srj.obstacles
          .filter(
            (obstacle) =>
              pointInsideObstacle(segment.start, obstacle) &&
              pointInsideObstacle(segment.end, obstacle),
          )
          .map((obstacle) => ({
            traceId: trace.pcb_trace_id,
            connectionName: trace.connection_name,
            fromLayer: segment.from_layer,
            toLayer: segment.to_layer,
            obstacle: getObstacleLabel(obstacle),
          }))
      }),
    )

  expect(highDensityViasInsideObstacles).toEqual([])
  expect(outputViasInsideObstacles).toEqual([])
  expect(throughObstacleSegmentsInsideObstacles).toContainEqual(
    expect.objectContaining({
      connectionName: "source_net_1",
      fromLayer: "top",
      toLayer: "bottom",
    }),
  )
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 120_000)
