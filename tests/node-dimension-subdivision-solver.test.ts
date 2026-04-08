import { expect, test } from "bun:test"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"

const createNode = (
  overrides: Partial<CapacityMeshNode> = {},
): CapacityMeshNode => ({
  capacityMeshNodeId: "cmn_0",
  center: { x: 0, y: 0 },
  width: 12,
  height: 2,
  layer: "top",
  availableZ: [0],
  ...overrides,
})

const getNodeRatio = (node: Pick<CapacityMeshNode, "width" | "height">) =>
  Math.max(node.width, node.height) / Math.min(node.width, node.height)

test("NodeDimensionSubdivisionSolver leaves long thin nodes alone when maxNodeRatio is unset", () => {
  const solver = new NodeDimensionSubdivisionSolver([createNode()], 100)

  solver.solve()

  expect(solver.outputNodes).toHaveLength(1)
  expect(solver.outputNodes[0]?.capacityMeshNodeId).toBe("cmn_0")
})

test("NodeDimensionSubdivisionSolver subdivides long thin nodes to satisfy maxNodeRatio", () => {
  const solver = new NodeDimensionSubdivisionSolver([createNode()], 100, 4)

  solver.solve()

  expect(solver.outputNodes).toHaveLength(2)
  expect(solver.outputNodes.every((node) => getNodeRatio(node) <= 4)).toBe(true)
  expect(solver.stats.maxNodeDimension).toBe(100)
  expect(solver.stats.maxNodeRatio).toBe(4)
})
