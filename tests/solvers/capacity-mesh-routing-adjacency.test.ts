import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import {
  getRoutingAdjacencyReason,
  getMaxRoutingAdjacencyGap,
} from "lib/solvers/CapacityMeshSolver/getRoutingAdjacencyReason"
import type { CapacityMeshNode } from "lib/types"

const createNode = (
  capacityMeshNodeId: string,
  center: { x: number; y: number },
  width: number,
  height: number,
  availableZ: number[],
  extra: Partial<CapacityMeshNode> = {},
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center,
  width,
  height,
  layer: "top",
  availableZ,
  ...extra,
})

test("routing adjacency treats overlapping same-layer regions as neighbors", () => {
  const nodeA = createNode("a", { x: 0, y: 0 }, 0.15, 0.15, [0])
  const nodeB = createNode("b", { x: 0.1, y: 0 }, 0.9, 0.18, [0])

  expect(getRoutingAdjacencyReason(nodeA, nodeB)).toBe("overlap")
})

test("routing adjacency treats small same-layer gaps as neighbors", () => {
  const nodeA = createNode("a", { x: 0, y: 0 }, 0.15, 0.15, [0])
  const nodeB = createNode("b", { x: 0.215, y: 0 }, 0.14, 0.18, [0])

  expect(getRoutingAdjacencyReason(nodeA, nodeB)).toBe("small_gap")
})

test("routing adjacency rejects large same-layer gaps", () => {
  const maxGap = getMaxRoutingAdjacencyGap()
  const nodeA = createNode("a", { x: 0, y: 0 }, 0.15, 0.15, [0])
  const nodeB = createNode(
    "b",
    { x: 0.15 + 0.14 + maxGap + 0.05, y: 0 },
    0.14,
    0.18,
    [0],
  )

  expect(getRoutingAdjacencyReason(nodeA, nodeB)).toBeNull()
})

test("routing adjacency rejects close regions without shared layers", () => {
  const nodeA = createNode("a", { x: 0, y: 0 }, 0.15, 0.15, [0])
  const nodeB = createNode("b", { x: 0.215, y: 0 }, 0.14, 0.18, [1])

  expect(getRoutingAdjacencyReason(nodeA, nodeB)).toBeNull()
})

test("optimized capacity edge solver adds overlap and small-gap edges", () => {
  const nodes: CapacityMeshNode[] = [
    createNode("overlap_a", { x: 0, y: 0 }, 0.15, 0.15, [0]),
    createNode("overlap_b", { x: 0.1, y: 0 }, 0.9, 0.18, [0]),
    createNode("gap_a", { x: 2, y: 0 }, 0.15, 0.15, [0]),
    createNode("gap_b", { x: 2.215, y: 0 }, 0.14, 0.18, [0]),
    createNode("cross_layer", { x: 2.215, y: 0.4 }, 0.14, 0.18, [1]),
  ]

  const solver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  solver.solve()

  expect(
    solver.edges.some(
      (edge) =>
        edge.nodeIds.includes("overlap_a") && edge.nodeIds.includes("overlap_b"),
    ),
  ).toBe(true)
  expect(
    solver.edges.some(
      (edge) => edge.nodeIds.includes("gap_a") && edge.nodeIds.includes("gap_b"),
    ),
  ).toBe(true)
  expect(
    solver.edges.some(
      (edge) =>
        edge.nodeIds.includes("gap_a") && edge.nodeIds.includes("cross_layer"),
    ),
  ).toBe(false)
})
