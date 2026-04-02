import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"

const getCircuit011 = () =>
  (dataset01 as Record<string, unknown>).circuit011 as any

test("pipeline4 defaults node subdivision to 16mm", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    structuredClone(getCircuit011()),
  )

  pipeline.solveUntilPhase("edgeSolver")

  expect(pipeline.maxNodeDimension).toBe(16)
  expect(pipeline.maxRectRatio).toBe(2)
  expect(pipeline.capacityNodes).toBeDefined()
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeLessThanOrEqual(16)
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeGreaterThan(8)
  expect(
    pipeline.nodeDimensionSubdivisionSolver?.stats.subdividedNodeCount,
  ).toBeGreaterThan(0)
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeDimension).toBe(
    16,
  )
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxRectRatio).toBe(2)
})

test("pipeline5 defaults node subdivision to 8mm", () => {
  const pipeline = new AutoroutingPipelineSolver5(
    structuredClone(getCircuit011()),
  )

  pipeline.solveUntilPhase("edgeSolver")

  expect(pipeline.maxNodeDimension).toBe(8)
  expect(pipeline.maxRectRatio).toBe(2)
  expect(pipeline.capacityNodes).toBeDefined()
  expect(
    Math.max(
      ...(pipeline.capacityNodes ?? []).map((node) =>
        Math.max(node.width, node.height),
      ),
    ),
  ).toBeLessThanOrEqual(8)
  expect(
    pipeline.nodeDimensionSubdivisionSolver?.stats.subdividedNodeCount,
  ).toBeGreaterThan(0)
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxNodeDimension).toBe(
    8,
  )
  expect(pipeline.nodeDimensionSubdivisionSolver?.stats.maxRectRatio).toBe(2)
})

test("node subdivision splits elongated rects when max rect ratio is exceeded", () => {
  const node: CapacityMeshNode = {
    capacityMeshNodeId: "cmn_elongated",
    center: { x: 6, y: 1 },
    width: 12,
    height: 2,
    layer: "top",
    availableZ: [0],
  }

  const solver = new NodeDimensionSubdivisionSolver([node], 16, 2)
  solver.solve()

  expect(solver.outputNodes).toHaveLength(2)
  expect(solver.stats.maxNodeDimension).toBe(16)
  expect(solver.stats.maxRectRatio).toBe(2)
  expect(solver.stats.subdividedNodeCount).toBe(1)
  expect(solver.outputNodes.every((child) => child.width === 6)).toBe(true)
  expect(solver.outputNodes.every((child) => child.height === 2)).toBe(true)
})
