import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { Pipeline4ForceImproveSolver } from "lib/solvers/ForceImproveSolver/Pipeline4ForceImproveSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -0.5, y: 0, layer: "top" },
        { x: 0.5, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
}

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_1",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  portPoints: [
    {
      connectionName: "conn1",
      x: -0.5,
      y: 0,
      z: 0,
    },
    {
      connectionName: "conn1",
      x: 0.5,
      y: 0,
      z: 0,
    },
  ],
}

const hdRoute: HighDensityRoute = {
  connectionName: "conn1",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -0.5, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
  ],
  vias: [],
}

test("Pipeline4HighDensityRepairSolver preserves simple no-op routes", () => {
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: [hdRoute],
    obstacles: [],
    repairMargin: 0.2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([hdRoute])
})

test("pipeline4 inserts force-improve after high density and before stitching", () => {
  const solver = new AutoroutingPipelineSolver4(srj)
  const phaseNames = solver.pipelineDef.map((step) => step.solverName)

  expect(phaseNames.indexOf("highDensityRouteSolver")).toBeGreaterThanOrEqual(0)
  expect(phaseNames.indexOf("forceImproveSolver")).toBe(
    phaseNames.indexOf("highDensityRouteSolver") + 1,
  )
  expect(phaseNames.indexOf("highDensityStitchSolver")).toBe(
    phaseNames.indexOf("forceImproveSolver") + 1,
  )
})

test("Pipeline4ForceImproveSolver preserves simple no-op routes", () => {
  const solver = new Pipeline4ForceImproveSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: [hdRoute],
    totalSteps: 8,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([hdRoute])
})

test("Pipeline4ForceImproveSolver adjusts close routes inside a node", () => {
  const routeA: HighDensityRoute = {
    connectionName: "conn1",
    rootConnectionName: "conn1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.8, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routeB: HighDensityRoute = {
    connectionName: "conn2",
    rootConnectionName: "conn2",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.15, y: -0.8, z: 0 },
      { x: 0.15, y: 0.05, z: 0 },
      { x: 0.15, y: 0.8, z: 0 },
    ],
    vias: [],
  }

  const solver = new Pipeline4ForceImproveSolver({
    nodeWithPortPoints: [
      {
        ...nodeWithPortPoints,
        portPoints: [
          { connectionName: "conn1", x: -0.8, y: 0, z: 0 },
          { connectionName: "conn1", x: 0.8, y: 0, z: 0 },
          { connectionName: "conn2", x: 0.15, y: -0.8, z: 0 },
          { connectionName: "conn2", x: 0.15, y: 0.8, z: 0 },
        ],
      },
    ],
    hdRoutes: [routeA, routeB],
    totalSteps: 12,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  const [improvedA, improvedB] = solver.getOutput()
  expect(improvedA.route[0]).toEqual(routeA.route[0])
  expect(improvedA.route[improvedA.route.length - 1]).toEqual(
    routeA.route[routeA.route.length - 1],
  )
  expect(improvedB.route[0]).toEqual(routeB.route[0])
  expect(improvedB.route[improvedB.route.length - 1]).toEqual(
    routeB.route[routeB.route.length - 1],
  )
  expect(improvedA.route[1]).not.toEqual(routeA.route[1])
  expect(improvedB.route[1]).not.toEqual(routeB.route[1])
})

test("Pipeline4ForceImproveSolver visualize shows the whole circuit and highlights the active node", () => {
  const nodeA: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_a",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { connectionName: "conn1", x: -0.8, y: 0, z: 0 },
      { connectionName: "conn1", x: 0.8, y: 0, z: 0 },
    ],
  }
  const nodeB: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_b",
    center: { x: 10, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { connectionName: "conn2", x: 9.2, y: 0, z: 0 },
      { connectionName: "conn2", x: 10.8, y: 0, z: 0 },
    ],
  }
  const routeA: HighDensityRoute = {
    connectionName: "conn1",
    rootConnectionName: "conn1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.8, y: 0, z: 0 },
      { x: 0.95, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routeB: HighDensityRoute = {
    connectionName: "conn2",
    rootConnectionName: "conn2",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 9.2, y: 0, z: 0 },
      { x: 10.95, y: 0, z: 0 },
      { x: 10.8, y: 0, z: 0 },
    ],
    vias: [],
  }

  const solver = new Pipeline4ForceImproveSolver({
    nodeWithPortPoints: [nodeA, nodeB],
    hdRoutes: [routeA, routeB],
    totalSteps: 2,
  })

  solver.step()
  const firstViz = solver.visualize()
  expect(firstViz.title).toContain("cmn_a")
  expect(firstViz.title).toContain("1/2")
  expect(firstViz.title).toContain("offset")
  expect(
    (firstViz.lines ?? []).some((line) =>
      line.points.some((point) => point.x < 5),
    ),
  ).toBe(true)
  expect(
    (firstViz.lines ?? []).some((line) =>
      line.points.some((point) => point.x > 5),
    ),
  ).toBe(true)
  expect((firstViz.points ?? []).some((point) => point.x < 5)).toBe(true)
  expect((firstViz.points ?? []).some((point) => point.x > 5)).toBe(true)
  expect(
    (firstViz.rects ?? []).some((rect) => rect.label === "cmn_a active node"),
  ).toBe(true)
  expect(
    (firstViz.rects ?? []).some((rect) => rect.label === "cmn_b node"),
  ).toBe(true)
  expect(
    (firstViz.lines ?? []).some((line) => line.label === "conn1 initial route"),
  ).toBe(true)
  expect(
    (firstViz.lines ?? []).some(
      (line) => line.label === "conn1 desired direction",
    ),
  ).toBe(true)
  expect(
    (firstViz.lines ?? []).filter(
      (line) => line.label === "cmn_a active node border",
    ),
  ).toHaveLength(4)

  solver.step()
  const secondViz = solver.visualize()
  expect(secondViz.title).toContain("cmn_a")
  expect(secondViz.title).toContain("2/2")

  solver.step()
  const thirdViz = solver.visualize()
  expect(thirdViz.title).toContain("cmn_b")
  expect(thirdViz.title).toContain("1/2")
  expect(
    (thirdViz.lines ?? []).some((line) =>
      line.points.some((point) => point.x < 5),
    ),
  ).toBe(true)
  expect(
    (thirdViz.lines ?? []).some((line) =>
      line.points.some((point) => point.x > 5),
    ),
  ).toBe(true)
  expect((thirdViz.points ?? []).some((point) => point.x < 5)).toBe(true)
  expect((thirdViz.points ?? []).some((point) => point.x > 5)).toBe(true)
  expect(
    (thirdViz.lines ?? []).filter(
      (line) => line.label === "cmn_b active node border",
    ),
  ).toHaveLength(4)
})

test("pipeline4 stitch stage consumes force-improved high density routes", () => {
  const rawRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }
  const improvedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.1, y: 0.35, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.srjWithPointPairs = srj
  solver.highDensityRouteSolver = { routes: [rawRoute] } as any
  solver.forceImproveSolver = {
    getOutput: () => [improvedRoute],
  } as any

  const stitchStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityStitchSolver",
  )
  const [stitchParams] = stitchStep!.getConstructorParams(solver) as any

  expect(stitchParams.hdRoutes).toEqual([improvedRoute])
})

test(
  "pipeline4 real case force-improve changes output routes",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.highDensityNodePortPoints?.length ?? 0).toBeGreaterThan(0)

    const inputRoutes = solver.highDensityRouteSolver?.routes ?? []
    const improvedRoutes = solver.forceImproveSolver?.getOutput() ?? []

    expect(improvedRoutes.length).toBe(inputRoutes.length)

    const changedRouteCount = improvedRoutes.filter((route, index) => {
      const inputRoute = inputRoutes[index]
      return (
        JSON.stringify(route.route) !== JSON.stringify(inputRoute?.route) ||
        JSON.stringify(route.vias) !== JSON.stringify(inputRoute?.vias)
      )
    }).length

    expect(changedRouteCount).toBeGreaterThan(0)
  },
  { timeout: 60000 },
)

test(
  "pipeline4 real case stitch step input equals force-improved output",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)

    solver.solve()

    const stitchStep = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    const [stitchParams] = stitchStep!.getConstructorParams(solver) as any
    const improvedRoutes = solver.forceImproveSolver?.getOutput() ?? []
    const rawRoutes = solver.highDensityRouteSolver?.routes ?? []

    expect(stitchParams.hdRoutes).toEqual(improvedRoutes)
    expect(stitchParams.hdRoutes.length).toBe(rawRoutes.length)

    const changedRouteCount = stitchParams.hdRoutes.filter(
      (route: HighDensityRoute, index: number) =>
        JSON.stringify(route.route) !==
          JSON.stringify(rawRoutes[index]?.route) ||
        JSON.stringify(route.vias) !== JSON.stringify(rawRoutes[index]?.vias),
    ).length

    expect(changedRouteCount).toBeGreaterThan(0)
  },
  { timeout: 60000 },
)
