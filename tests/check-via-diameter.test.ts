import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

test("all vias in visualization should be 0.3mm diameter, not 0.6mm", () => {
  // Create a simple test case that requires vias
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2, y: 2, layer: "bottom" },
        ],
      },
    ],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  }

  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)

  // Get the visualization output
  const visualization = solver.visualize()

  // Check all circles (vias) in the visualization
  const circles = visualization.circles || []

  console.log("Found circles:", circles.length)

  for (const circle of circles) {
    console.log("Circle:", {
      center: circle.center,
      radius: circle.radius,
      diameter: circle.radius * 2,
      layer: circle.layer,
      label: circle.label,
    })

    // Check that no vias have 0.6mm diameter (0.3 radius)
    if (circle.radius === 0.3) {
      throw new Error(
        `Found via with 0.6mm diameter (0.3 radius) at ${JSON.stringify(circle.center)}. ` +
        `Expected 0.3mm diameter (0.15 radius). Label: ${circle.label}`
      )
    }

    // Vias should be 0.3mm diameter (0.15 radius)
    if (circle.label?.includes("via") || circle.layer?.includes(",")) {
      expect(circle.radius).toBe(0.15)
    }
  }
})

test("all vias in circuit-json export should be 0.3mm diameter, not 0.6mm", () => {
  // Create a simple test case that requires vias
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2, y: 2, layer: "bottom" },
        ],
      },
    ],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  }

  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)

  const srjWithPointPairs = solver.srjWithPointPairs!
  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const hdRoutes = solver._getOutputHdRoutes()
  const viaDiameter = hdRoutes[0]?.viaDiameter ?? 0.3

  const circuitJson = convertToCircuitJson(
    srjWithPointPairs,
    simplifiedTraces,
    srj.minTraceWidth,
    viaDiameter,
  )

  // Find all vias in the circuit json
  const vias = circuitJson.filter((el) => el.type === "pcb_via")

  console.log("Found vias in circuit json:", vias.length)

  for (const via of vias) {
    console.log("Via:", {
      outer_diameter: via.outer_diameter,
      hole_diameter: via.hole_diameter,
      x: via.x,
      y: via.y,
    })

    // Check that no vias have 0.6mm outer diameter
    if (via.outer_diameter === 0.6) {
      throw new Error(
        `Found via with 0.6mm outer diameter at (${via.x}, ${via.y}). ` +
        `Expected 0.3mm outer diameter.`
      )
    }

    // Vias should be 0.3mm outer diameter
    expect(via.outer_diameter).toBe(0.3)
    expect(via.hole_diameter).toBe(0.15)
  }
})
