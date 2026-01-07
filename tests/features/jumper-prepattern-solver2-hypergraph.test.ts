import { test, expect } from "bun:test"
import { JumperPrepatternSolver2_HyperGraph } from "lib/solvers/JumperPrepatternSolver/JumperPrepatternSolver2_HyperGraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("JumperPrepatternSolver2_HyperGraph - single_1206x4 pattern simple route", () => {
  // Create a node large enough for the ~8x8mm single_1206x4 pattern
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

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    hyperParameters: {
      PATTERN_TYPE: "single_1206x4",
      ORIENTATION: "vertical",
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)
  expect(solver.solvedRoutes[0].connectionName).toBe("conn1")
})

test("JumperPrepatternSolver2_HyperGraph - 2x2_1206x4 pattern simple route", () => {
  // Create a node large enough for the ~14x14mm 2x2_1206x4 pattern
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

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    hyperParameters: {
      PATTERN_TYPE: "2x2_1206x4",
      ORIENTATION: "vertical",
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)
  expect(solver.solvedRoutes[0].connectionName).toBe("conn1")
})

test("JumperPrepatternSolver2_HyperGraph - multiple connections", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 5, y: 5 },
    width: 12,
    height: 12,
    portPoints: [
      // Connection 1: left to right
      { connectionName: "conn1", x: 1, y: 3, z: 0 },
      { connectionName: "conn1", x: 9, y: 3, z: 0 },
      // Connection 2: top to bottom
      { connectionName: "conn2", x: 1, y: 7, z: 0 },
      { connectionName: "conn2", x: 9, y: 7, z: 0 },
    ],
  }

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    hyperParameters: {
      PATTERN_TYPE: "single_1206x4",
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(2)
})

test("JumperPrepatternSolver2_HyperGraph - horizontal orientation", () => {
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

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    hyperParameters: {
      PATTERN_TYPE: "single_1206x4",
      ORIENTATION: "horizontal",
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)
})

test("JumperPrepatternSolver2_HyperGraph - visualize() returns valid graphics", () => {
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

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    hyperParameters: {
      PATTERN_TYPE: "single_1206x4",
    },
  })

  solver.solve()

  const graphics = solver.visualize()

  // Should have visualization data
  expect(graphics.points).toBeDefined()
  expect(graphics.lines).toBeDefined()
  expect(graphics.rects).toBeDefined()

  // Should have port points visualized
  expect(graphics.points!.length).toBeGreaterThan(0)

  // Should have route lines visualized
  expect(graphics.lines!.length).toBeGreaterThan(0)
})

test("JumperPrepatternSolver2_HyperGraph - no connections needed for single port", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 5, y: 5 },
    width: 12,
    height: 12,
    portPoints: [
      // Only one port point - no connection to make
      { connectionName: "conn1", x: 1, y: 5, z: 0 },
    ],
  }

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    hyperParameters: {
      PATTERN_TYPE: "single_1206x4",
    },
  })

  solver.solve()

  // Should solve immediately with no routes
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(0)
})

test("JumperPrepatternSolver2_HyperGraph - default pattern is single_1206x4", () => {
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

  const solver = new JumperPrepatternSolver2_HyperGraph({
    nodeWithPortPoints,
    // No hyperParameters - should use defaults
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)
})
