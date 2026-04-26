import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { PolySingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolySingleIntraNodeSolver"
import {
  applyMatrixToPoint,
  computeProjectedRect,
  getProjectedRectCorners,
  isPointInConvexPolygon,
  projectPointToRectBoundary,
} from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/geometry"
import type { PolyNodeWithPortPoints } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/types"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const expectClose = (actual: number, expected: number, tolerance = 1e-6) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

test("Pipeline6 projectedRect area expansion preserves center and reaches polygon area", () => {
  const rotatedSquare = [
    { x: 0, y: -Math.SQRT2 },
    { x: Math.SQRT2, y: 0 },
    { x: 0, y: Math.SQRT2 },
    { x: -Math.SQRT2, y: 0 },
  ]
  const trapezoid = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ]

  const insideRect = computeProjectedRect(rotatedSquare, 0)
  const equivalentAreaRect = computeProjectedRect(trapezoid, 1)

  expectClose(insideRect.center.x, 0)
  expectClose(insideRect.center.y, 0)
  expectClose(insideRect.width * insideRect.height, 4)
  expectClose(insideRect.ccwRotationDegrees, 45, 0.05)
  expectClose(
    equivalentAreaRect.width * equivalentAreaRect.height,
    equivalentAreaRect.polygonArea,
  )
  expectClose(equivalentAreaRect.polygonArea, 20)

  for (const corner of getProjectedRectCorners(insideRect)) {
    expect(isPointInConvexPolygon(corner, rotatedSquare)).toBe(true)
  }

  const projectedTopCorner = projectPointToRectBoundary(
    rotatedSquare[0]!,
    insideRect,
  )
  expectClose(projectedTopCorner.x, -1)
  expectClose(projectedTopCorner.y, -1)
  const distortedTopCorner = applyMatrixToPoint(
    insideRect.rectToPolygonMatrix,
    projectedTopCorner,
  )
  expectClose(distortedTopCorner.x, rotatedSquare[0]!.x)
  expectClose(distortedTopCorner.y, rotatedSquare[0]!.y)
})

test("PolySingleIntraNodeSolver projects into a rect and distorts solved routes back to polygon", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ]
  const node: PolyNodeWithPortPoints = {
    capacityMeshNodeId: "poly-node-1",
    center: { x: 3, y: 2 },
    width: 6,
    height: 4,
    availableZ: [0, 1],
    polygon,
    projectedRect: computeProjectedRect(polygon, 0.25),
    portPoints: [
      { connectionName: "a", x: 0.5, y: 0.5, z: 0 },
      { connectionName: "a", x: 5.5, y: 3.5, z: 0 },
      { connectionName: "b", x: 5.5, y: 0.5, z: 0 },
      { connectionName: "b", x: 0.5, y: 3.5, z: 0 },
    ],
  }

  const solver = new PolySingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    effort: 0.2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(2)

  for (const route of solver.solvedRoutes) {
    const endpoints = node.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    expect(endpoints).toHaveLength(2)
    expect(route.route[0]).toMatchObject({
      x: endpoints[0]!.x,
      y: endpoints[0]!.y,
      z: endpoints[0]!.z,
    })
    expect(route.route[route.route.length - 1]).toMatchObject({
      x: endpoints[1]!.x,
      y: endpoints[1]!.y,
      z: endpoints[1]!.z,
    })
  }

  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "poly-single-intra-node",
  })
})

test("Pipeline6 solves and snapshots a small obstacle route", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [
      {
        type: "rect",
        center: { x: 5, y: 5 },
        width: 2,
        height: 2,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 1, y: 1, layer: "top" },
          { x: 9, y: 9, layer: "top" },
        ],
      },
      {
        name: "net2",
        pointsToConnect: [
          { x: 1, y: 9, layer: "top" },
          { x: 9, y: 1, layer: "top" },
        ],
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver6(srj, {
    effort: 0.2,
    equivalentAreaExpansionFactor: 0.25,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.projectedHighDensityNodePortPoints?.length).toBeGreaterThan(0)
  expect(
    solver.projectedHighDensityNodePortPoints?.every((node) =>
      Boolean(node.projectedRect),
    ),
  ).toBe(true)
  expect(solver.highDensityRouteSolver?.routes.length).toBeGreaterThan(0)
  expect(solver.getOutputSimpleRouteJson().traces).toHaveLength(2)

  expect(solver.attachProjectedRectsSolver!.visualize()).toMatchGraphicsSvg(
    import.meta.path,
    { svgName: "pipeline6-projected-rects" },
  )
  expect(solver.highDensityRouteSolver!.visualize()).toMatchGraphicsSvg(
    import.meta.path,
    { svgName: "pipeline6-poly-high-density" },
  )
  expect(
    convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()),
  ).toMatchGraphicsSvg(import.meta.path, { svgName: "pipeline6-output" })
})
