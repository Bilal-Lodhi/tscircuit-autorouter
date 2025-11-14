import { test, expect } from "bun:test"
import { CapacityMeshSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../examples/bug-reports/bugreport10-b2de3c/bugreport10-b2de3c.json" assert {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("check bugreport10 via diameters in visualization even when solver fails", () => {
  const solver = new CapacityMeshSolver(srj)

  console.log("Starting solver...")
  solver.solve()

  console.log("Solver status:", {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
  })

  // Get visualization even if solver failed
  const viz = solver.visualize()
  const circles = viz.circles || []

  console.log(`\nFound ${circles.length} circles in visualization`)

  const viaDiameterCounts: Record<string, number> = {}

  for (const circle of circles) {
    // Only check circles that are likely vias (radius > 0.1mm)
    if (circle.radius > 0.1) {
      const diameter = circle.radius * 2
      const diameterStr = diameter.toFixed(2)
      viaDiameterCounts[diameterStr] = (viaDiameterCounts[diameterStr] || 0) + 1

      console.log(`Via: radius=${circle.radius.toFixed(3)}, diameter=${diameter.toFixed(3)}, label="${circle.label || ''}"`)

      // Check for the old 0.6mm diameter vias
      if (Math.abs(diameter - 0.6) < 0.01) {
        console.error(`❌ Found via with 0.6mm diameter at (${circle.center?.x}, ${circle.center?.y})`)
        console.error(`   Label: ${circle.label}`)
      } else if (Math.abs(diameter - 0.3) < 0.01) {
        console.log(`✓ Correct 0.3mm diameter via`)
      } else {
        console.warn(`⚠ Unusual via diameter: ${diameter.toFixed(3)}mm`)
      }
    }
  }

  console.log("\nVia diameter summary:")
  for (const [diameter, count] of Object.entries(viaDiameterCounts)) {
    console.log(`  ${diameter}mm: ${count} vias`)
  }

  // Fail test if any 0.6mm vias found
  const has06mmVias = Object.keys(viaDiameterCounts).some(d => Math.abs(parseFloat(d) - 0.6) < 0.01)
  if (has06mmVias) {
    throw new Error("Found vias with 0.6mm diameter! All vias should be 0.3mm")
  }
}, { timeout: 120000 })
