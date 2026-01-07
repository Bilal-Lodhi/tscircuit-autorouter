import { test, expect } from "bun:test"
import { HyperJumperPrepatternSolver2 } from "lib/solvers/JumperPrepatternSolver/HyperJumperPrepatternSolver2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("HyperJumperPrepatternSolver2 - tries multiple variants and finds solution", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 5, y: 5 },
    width: 12,
    height: 12,
    portPoints: [
      { connectionName: "conn1", x: 1, y: 5, z: 0 },
      { connectionName: "conn1", x: 9, y: 5, z: 0 },
    ],
  }

  const solver = new HyperJumperPrepatternSolver2({
    nodeWithPortPoints,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)
  expect(solver.solvedRoutes[0].connectionName).toBe("conn1")
})

test("HyperJumperPrepatternSolver2 - uses 2x2 pattern for large nodes", () => {
  // Large node that can fit 2x2_1206x4 pattern (~14x14mm)
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 10, y: 10 },
    width: 20,
    height: 20,
    portPoints: [
      { connectionName: "conn1", x: 2, y: 10, z: 0 },
      { connectionName: "conn1", x: 18, y: 10, z: 0 },
    ],
  }

  const solver = new HyperJumperPrepatternSolver2({
    nodeWithPortPoints,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)

  // Should have tried both single and 2x2 patterns
  expect(solver.supervisedSolvers!.length).toBe(4) // 2 patterns x 2 orientations
})

test("HyperJumperPrepatternSolver2 - only uses single pattern for small nodes", () => {
  // Small node that can only fit single_1206x4 pattern
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 5, y: 5 },
    width: 10,
    height: 10,
    portPoints: [
      { connectionName: "conn1", x: 1, y: 5, z: 0 },
      { connectionName: "conn1", x: 9, y: 5, z: 0 },
    ],
  }

  const solver = new HyperJumperPrepatternSolver2({
    nodeWithPortPoints,
  })

  solver.solve()

  expect(solver.solved).toBe(true)

  // Should only have tried single pattern variants (2 orientations)
  expect(solver.supervisedSolvers!.length).toBe(2)
})

test("HyperJumperPrepatternSolver2 - multiple connections", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 5, y: 5 },
    width: 12,
    height: 12,
    portPoints: [
      { connectionName: "conn1", x: 1, y: 3, z: 0 },
      { connectionName: "conn1", x: 9, y: 3, z: 0 },
      { connectionName: "conn2", x: 1, y: 7, z: 0 },
      { connectionName: "conn2", x: 9, y: 7, z: 0 },
    ],
  }

  const solver = new HyperJumperPrepatternSolver2({
    nodeWithPortPoints,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(2)
})

test("HyperJumperPrepatternSolver2 - getOutput returns solved routes", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 5, y: 5 },
    width: 12,
    height: 12,
    portPoints: [
      { connectionName: "conn1", x: 1, y: 5, z: 0 },
      { connectionName: "conn1", x: 9, y: 5, z: 0 },
    ],
  }

  const solver = new HyperJumperPrepatternSolver2({
    nodeWithPortPoints,
  })

  solver.solve()

  const output = solver.getOutput()
  expect(output).toBeDefined()
  expect(output.length).toBe(1)
  expect(output[0].connectionName).toBe("conn1")
})
