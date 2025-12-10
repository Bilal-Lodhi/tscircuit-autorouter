import { expect, test } from "bun:test"
import { CapacityNodeAspectRatioSolver } from "lib/solvers/CapacityMeshSolver/CapacityNodeAspectRatioSolver"
import type { CapacityMeshNode } from "lib/types"

const baseNode: CapacityMeshNode = {
  capacityMeshNodeId: "node-1",
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  layer: "top",
  availableZ: [0],
}

test("does not split nodes within aspect ratio threshold", () => {
  const solver = new CapacityNodeAspectRatioSolver({ nodes: [baseNode] })

  solver.solve()

  expect(solver.getResultNodes()).toHaveLength(1)
  expect(solver.getResultNodes()[0]).toEqual(baseNode)
})

test("splits wide nodes to meet aspect ratio threshold", () => {
  const wideNode: CapacityMeshNode = {
    ...baseNode,
    capacityMeshNodeId: "wide",
    width: 10,
    height: 2,
  }

  const solver = new CapacityNodeAspectRatioSolver({
    nodes: [wideNode],
    maxAspectRatio: 1.2,
  })

  solver.solve()

  const nodes = solver.getResultNodes()

  expect(nodes).toHaveLength(5)
  expect(nodes.every((n) => n.width <= 2.5 && n.height === 2)).toBeTrue()
  expect(nodes.map((n) => n.capacityMeshNodeId)).toEqual([
    "wide_split1",
    "wide_split2",
    "wide_split3",
    "wide_split4",
    "wide_split5",
  ])
  expect(nodes[0]?.center.x).toBeCloseTo(-4)
  expect(nodes.at(-1)?.center.x).toBeCloseTo(4)
})

test("splits tall nodes to meet aspect ratio threshold", () => {
  const tallNode: CapacityMeshNode = {
    ...baseNode,
    capacityMeshNodeId: "tall",
    width: 2,
    height: 10,
  }

  const solver = new CapacityNodeAspectRatioSolver({
    nodes: [tallNode],
    maxAspectRatio: 1.2,
  })

  solver.solve()

  const nodes = solver.getResultNodes()

  expect(nodes).toHaveLength(5)
  expect(nodes.every((n) => n.height <= 2.5 && n.width === 2)).toBeTrue()
  expect(nodes[0]?.center.y).toBeCloseTo(-4)
  expect(nodes.at(-1)?.center.y).toBeCloseTo(4)
})
