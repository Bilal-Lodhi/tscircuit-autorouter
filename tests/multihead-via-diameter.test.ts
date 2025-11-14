import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("MultiHeadPolyLineIntraNodeSolver should use 0.3mm via diameter", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "test-node",
    center: { x: 0, y: 0 },
    width: 5,
    height: 5,
    portPoints: [
      { connectionName: "net1", x: -1, y: -1, z: 0 },
      { connectionName: "net1", x: 1, y: 1, z: 1 },
      { connectionName: "net2", x: -1, y: 1, z: 0 },
      { connectionName: "net2", x: 1, y: -1, z: 1 },
    ],
    availableZ: [0, 1],
  }

  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints,
  })

  solver.solve()

  expect(solver.solved).toBe(true)

  // Check that all solved routes have 0.3mm via diameter
  for (const route of solver.solvedRoutes) {
    console.log(
      `Route ${route.connectionName}: viaDiameter = ${route.viaDiameter}`,
    )
    expect(route.viaDiameter).toBe(0.3)
  }

  // Check visualization circles
  const viz = solver.visualize()
  const circles = viz.circles || []

  console.log(`Found ${circles.length} circles in visualization`)

  for (const circle of circles) {
    // Only check circles that are likely vias (radius > 0.1mm)
    // Some circles might be visual markers, grid points, etc.
    if (circle.radius > 0.1) {
      console.log(
        `Via circle: radius = ${circle.radius}, diameter = ${circle.radius * 2}`,
      )

      // Check that no vias have 0.3 radius (0.6mm diameter - the old incorrect value)
      if (Math.abs(circle.radius - 0.3) < 0.01) {
        throw new Error(
          `Found via with 0.6mm diameter (0.3 radius). Expected 0.3mm diameter (0.15 radius).`,
        )
      }

      // Vias should be 0.15 radius (0.3mm diameter)
      // Allow for small floating point differences
      if (Math.abs(circle.radius - 0.15) > 0.01) {
        throw new Error(
          `Found via with incorrect radius ${circle.radius} (expected 0.15 for 0.3mm diameter vias)`,
        )
      }
    }
  }
})
