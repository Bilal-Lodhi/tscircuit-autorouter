import { expect, test } from "bun:test"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import cmn645Sub00Node from "../fixtures/cmn_645__sub_0_0-node-with-port-points.json" with {
  type: "json",
}

const createStraightSegmentNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "single-layer-straight-segments",
  center: { x: 0, y: 0 },
  width: 8,
  height: 8,
  availableZ: [2],
  portPoints: [
    { connectionName: "connA", x: -3, y: -3, z: 2 },
    { connectionName: "connA", x: -3, y: -1, z: 2 },
    { connectionName: "connA", x: -3, y: 1, z: 2 },
    { connectionName: "connA", x: -3, y: 3, z: 2 },
    { connectionName: "connB", x: 0, y: -3, z: 2 },
    { connectionName: "connB", x: 0, y: 3, z: 2 },
    { connectionName: "connC", x: 3, y: -3, z: 2 },
    { connectionName: "connC", x: 3, y: 3, z: 2 },
  ],
})

const createSingleLayerCrossingNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "single-layer-crossing",
  center: { x: 0, y: 0 },
  width: 6,
  height: 6,
  availableZ: [0],
  portPoints: [
    { connectionName: "connA", x: -2.5, y: -2.5, z: 0 },
    { connectionName: "connA", x: 2.5, y: 2.5, z: 0 },
    { connectionName: "connB", x: -2.5, y: 2.5, z: 0 },
    { connectionName: "connB", x: 2.5, y: -2.5, z: 0 },
  ],
})

const expectStraightSingleLayerRoutes = (
  routes: HighDensityIntraNodeRoute[],
  expectedZ: number,
) => {
  expect(routes).not.toHaveLength(0)
  for (const route of routes) {
    expect(route.vias).toHaveLength(0)
    expect(route.route).toHaveLength(2)
    expect(route.route[0]!.z).toBe(expectedZ)
    expect(route.route[1]!.z).toBe(expectedZ)
  }
}

test("SingleLayerStraightSegment candidate solves a single-layer no-crossing node", () => {
  const hyperSolver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: createStraightSegmentNode(),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    effort: 1,
  })
  const solver = hyperSolver.generateSolver({
    SINGLE_LAYER_STRAIGHT_SEGMENTS: true,
  } as any)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getSolverName()).toBe(
    "SingleLayerStraightSegmentIntraNodeSolver",
  )
  expect((solver as any).solvedRoutes).toHaveLength(4)
  expectStraightSingleLayerRoutes((solver as any).solvedRoutes, 2)
})

test("SingleLayerStraightSegment candidate rejects a single-layer crossing node", () => {
  const hyperSolver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: createSingleLayerCrossingNode(),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    effort: 1,
  })
  const solver = hyperSolver.generateSolver({
    SINGLE_LAYER_STRAIGHT_SEGMENTS: true,
  } as any)

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain("not applicable")
})

test("HyperSingleIntraNodeSolver uses straight segments for cmn_645__sub_0_0", () => {
  const solver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: cmn645Sub00Node,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    effort: 1,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.winningSolver?.getSolverName()).toBe(
    "SingleLayerStraightSegmentIntraNodeSolver",
  )
  expect(solver.solvedRoutes).toHaveLength(6)
  expectStraightSingleLayerRoutes(solver.solvedRoutes, 2)
})
