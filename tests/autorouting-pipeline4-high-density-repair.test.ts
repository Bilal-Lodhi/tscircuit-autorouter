import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { HighDensityNodeForceImprovementSolver } from "lib/solvers/HighDensityNodeForceImprovementSolver/HighDensityNodeForceImprovementSolver"
import { IssueCorrectionSolver } from "lib/solvers/IssueCorrectionSolver/IssueCorrectionSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
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

test("HighDensityNodeForceImprovementSolver preserves simple no-op routes", () => {
  const solver = new HighDensityNodeForceImprovementSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: [hdRoute],
    obstacles: [],
    connMap: {
      idToNetMap: { conn1: "conn1" },
      netMap: { conn1: ["conn1"] },
    } as any,
    layerCount: 2,
    repairMargin: 0.2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([hdRoute])
})

test("pipeline4 inserts node force improvement stage after high density and before stitching", () => {
  const solver = new AutoroutingPipelineSolver4(srj)
  const phaseNames = solver.pipelineDef.map((step) => step.solverName)

  expect(phaseNames.indexOf("highDensityRouteSolver")).toBeGreaterThanOrEqual(0)
  expect(phaseNames.indexOf("highDensityNodeForceImprovementSolver")).toBe(
    phaseNames.indexOf("highDensityRouteSolver") + 1,
  )
  expect(phaseNames.indexOf("highDensityRepairSolver")).toBe(
    phaseNames.indexOf("highDensityNodeForceImprovementSolver") + 1,
  )
  expect(phaseNames.indexOf("issueCorrectionSolver")).toBe(
    phaseNames.indexOf("highDensityRepairSolver") + 1,
  )
  expect(phaseNames.indexOf("highDensityStitchSolver")).toBe(
    phaseNames.indexOf("issueCorrectionSolver") + 1,
  )
})

test("pipeline4 repair stage consumes node-force-improved routes", () => {
  const rawRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }
  const repairedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0.25, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.srjWithPointPairs = srj
  solver.highDensityRouteSolver = { routes: [rawRoute] } as any
  solver.highDensityNodeForceImprovementSolver = {
    getOutput: () => [repairedRoute],
  } as any

  const repairStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRepairSolver",
  )
  const [repairParams] = repairStep!.getConstructorParams(solver) as any

  expect(repairParams.hdRoutes).toEqual([repairedRoute])
})

test("IssueCorrectionSolver can correct a simple local pad overlap", () => {
  const correctionSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["pcb_smtpad_block", "pcb_port_block"],
      },
    ],
    connections: [
      {
        name: "conn1",
        pointsToConnect: [
          { x: -0.9, y: 0, layer: "top", pcb_port_id: "pcb_port_left" },
          { x: 0.9, y: 0, layer: "top", pcb_port_id: "pcb_port_right" },
        ],
      },
      {
        name: "blocker",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_block" }],
      },
    ],
  }
  const correctionNode: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_fix",
    center: { x: 0, y: 0 },
    width: 3,
    height: 2,
    portPoints: [
      { connectionName: "conn1", x: -0.9, y: 0, z: 0, portPointId: "left" },
      { connectionName: "conn1", x: 0.9, y: 0, z: 0, portPointId: "right" },
      { connectionName: "blocker", x: 0, y: 0, z: 0, portPointId: "block" },
    ],
  }
  const overlappingRoute: HighDensityRoute = {
    connectionName: "conn1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.9, y: 0, z: 0 },
      { x: 0.9, y: 0, z: 0 },
    ],
    vias: [],
  }

  const beforeDrc = getDrcErrors(
    convertToCircuitJson(
      correctionSrj,
      [overlappingRoute],
      correctionSrj.minTraceWidth,
      correctionSrj.minViaDiameter,
    ),
    RELAXED_DRC_OPTIONS,
  )
  expect(beforeDrc.errors.length).toBeGreaterThan(0)

  const solver = new IssueCorrectionSolver({
    simpleRouteJson: correctionSrj,
    nodeWithPortPoints: [correctionNode],
    hdRoutes: [overlappingRoute],
  })

  solver.solve()

  const afterRoutes = solver.getOutput()
  const afterDrc = getDrcErrors(
    convertToCircuitJson(
      correctionSrj,
      afterRoutes,
      correctionSrj.minTraceWidth,
      correctionSrj.minViaDiameter,
    ),
    RELAXED_DRC_OPTIONS,
  )

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(afterRoutes[0]?.route.length).toBeGreaterThan(overlappingRoute.route.length)
  expect(afterDrc.errors.length).toBe(0)
})

test("pipeline4 issue correction stage consumes repaired high density routes", () => {
  const repairedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0.25, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.srjWithPointPairs = srj
  solver.highDensityRepairSolver = {
    getOutput: () => [repairedRoute],
  } as any

  const issueCorrectionStep = solver.pipelineDef.find(
    (step) => step.solverName === "issueCorrectionSolver",
  )
  const [issueCorrectionParams] = issueCorrectionStep!.getConstructorParams(
    solver,
  ) as any

  expect(issueCorrectionParams.hdRoutes).toEqual([repairedRoute])
})

test("pipeline4 stitch stage consumes issue-corrected routes", () => {
  const repairedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0.1, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }
  const issueCorrectedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: -0.1, y: 0.28, z: 0 },
      { x: 0.1, y: 0.28, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.srjWithPointPairs = srj
  solver.highDensityRepairSolver = {
    getOutput: () => [repairedRoute],
  } as any
  solver.issueCorrectionSolver = {
    getOutput: () => [issueCorrectedRoute],
  } as any

  const stitchStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityStitchSolver",
  )
  const [stitchParams] = stitchStep!.getConstructorParams(solver) as any

  expect(stitchParams.hdRoutes).toEqual([issueCorrectedRoute])
})

test(
  "pipeline4 real case node force improvement runs on solved output",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.highDensityNodePortPoints?.length ?? 0).toBeGreaterThan(0)
    expect(
      solver.highDensityNodeForceImprovementSolver?.sampleEntries.length ?? 0,
    ).toBeGreaterThan(0)

    const inputRoutes = solver.highDensityRouteSolver?.routes ?? []
    const improvedRoutes =
      solver.highDensityNodeForceImprovementSolver?.getOutput() ?? []

    expect(improvedRoutes.length).toBe(inputRoutes.length)
  },
  { timeout: 60000 },
)

test(
  "pipeline4 real case stitch step input equals repaired output",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)

    solver.solve()

    const stitchStep = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    const [stitchParams] = stitchStep!.getConstructorParams(solver) as any
    const issueCorrectedRoutes = solver.issueCorrectionSolver?.getOutput() ?? []
    const rawRoutes = solver.highDensityRouteSolver?.routes ?? []

    expect(stitchParams.hdRoutes).toEqual(issueCorrectedRoutes)
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

for (const scenarioName of ["circuit002", "circuit015"] as const) {
  test(
    `pipeline4 ${scenarioName} passes relaxed DRC with node force improvement`,
    () => {
      const srj = structuredClone(
        (dataset01 as Record<string, unknown>)[scenarioName] as SimpleRouteJson,
      )
      const solver = new AutoroutingPipelineSolver4(srj)
      solver.solve()

      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)

      const output = solver.getOutputSimpleRouteJson()
      const circuitJson = convertToCircuitJson(
        solver.srjWithPointPairs ?? solver.srj,
        output.traces ?? [],
        solver.srj.minTraceWidth,
      )
      const drc = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

      expect(drc.errors).toHaveLength(0)
    },
    { timeout: 60000 },
  )
}
