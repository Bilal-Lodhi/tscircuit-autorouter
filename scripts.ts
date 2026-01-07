import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import bugReport from "./fixtures/bug-reports/bugreport36-d4c6c2/bugreport36-d4c6c2.json"
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

const solver = new AssignableAutoroutingPipeline2(srj)

solver.solve()

// Check after stitching
if (solver.highDensityStitchSolver?.solved) {
  console.log("\n=== After Stitch Solver ===")
  for (const route of solver.highDensityStitchSolver.mergedHdRoutes) {
    if (!route.jumpers || route.jumpers.length === 0) continue

    console.log("\nConnection:", route.connectionName)
    console.log("Route points:", route.route.length)
    console.log("Jumpers:")

    for (const j of route.jumpers) {
      console.log(
        `  ${j.footprint}: (${j.start.x.toFixed(2)}, ${j.start.y.toFixed(2)}) -> (${j.end.x.toFixed(2)}, ${j.end.y.toFixed(2)})`,
      )

      // Check if any route point is near the jumper pads
      let startPadIdx = -1
      let endPadIdx = -1

      for (let i = 0; i < route.route.length; i++) {
        const p = route.route[i]
        if (
          Math.abs(p.x - j.start.x) < 0.01 &&
          Math.abs(p.y - j.start.y) < 0.01
        ) {
          startPadIdx = i
        }
        if (Math.abs(p.x - j.end.x) < 0.01 && Math.abs(p.y - j.end.y) < 0.01) {
          endPadIdx = i
        }
      }

      console.log(`  Start pad found at index: ${startPadIdx}`)
      console.log(`  End pad found at index: ${endPadIdx}`)

      if (startPadIdx === -1) {
        // Find closest point to start pad
        let closestDist = Infinity
        let closestIdx = -1
        let closestPoint = null
        for (let i = 0; i < route.route.length; i++) {
          const p = route.route[i]
          const dist = Math.sqrt(
            (p.x - j.start.x) ** 2 + (p.y - j.start.y) ** 2,
          )
          if (dist < closestDist) {
            closestDist = dist
            closestIdx = i
            closestPoint = p
          }
        }
        console.log(
          `  Closest point to start pad: idx=${closestIdx}, dist=${closestDist.toFixed(3)}, point=(${closestPoint?.x.toFixed(2)}, ${closestPoint?.y.toFixed(2)})`,
        )
      }

      if (endPadIdx === -1) {
        // Find closest point to end pad
        let closestDist = Infinity
        let closestIdx = -1
        let closestPoint = null
        for (let i = 0; i < route.route.length; i++) {
          const p = route.route[i]
          const dist = Math.sqrt((p.x - j.end.x) ** 2 + (p.y - j.end.y) ** 2)
          if (dist < closestDist) {
            closestDist = dist
            closestIdx = i
            closestPoint = p
          }
        }
        console.log(
          `  Closest point to end pad: idx=${closestIdx}, dist=${closestDist.toFixed(3)}, point=(${closestPoint?.x.toFixed(2)}, ${closestPoint?.y.toFixed(2)})`,
        )
      }
    }
  }
}

// Also check after simplification
if (solver.traceSimplificationSolver?.solved) {
  console.log("\n=== After Trace Simplification ===")
  for (const route of solver.traceSimplificationSolver.simplifiedHdRoutes) {
    if (!route.jumpers || route.jumpers.length === 0) continue

    console.log("\nConnection:", route.connectionName)
    console.log("Route points:", route.route.length)

    for (const j of route.jumpers) {
      console.log(
        `  ${j.footprint}: (${j.start.x.toFixed(2)}, ${j.start.y.toFixed(2)}) -> (${j.end.x.toFixed(2)}, ${j.end.y.toFixed(2)})`,
      )

      // Check if any route point is near the jumper pads
      let startPadIdx = -1
      let endPadIdx = -1

      for (let i = 0; i < route.route.length; i++) {
        const p = route.route[i]
        if (
          Math.abs(p.x - j.start.x) < 0.01 &&
          Math.abs(p.y - j.start.y) < 0.01
        ) {
          startPadIdx = i
        }
        if (Math.abs(p.x - j.end.x) < 0.01 && Math.abs(p.y - j.end.y) < 0.01) {
          endPadIdx = i
        }
      }

      console.log(`  Start pad found at index: ${startPadIdx}`)
      console.log(`  End pad found at index: ${endPadIdx}`)

      if (startPadIdx === -1) {
        let closestDist = Infinity
        let closestIdx = -1
        let closestPoint = null
        for (let i = 0; i < route.route.length; i++) {
          const p = route.route[i]
          const dist = Math.sqrt(
            (p.x - j.start.x) ** 2 + (p.y - j.start.y) ** 2,
          )
          if (dist < closestDist) {
            closestDist = dist
            closestIdx = i
            closestPoint = p
          }
        }
        console.log(
          `  Closest point to start pad: idx=${closestIdx}, dist=${closestDist.toFixed(3)}, point=(${closestPoint?.x.toFixed(2)}, ${closestPoint?.y.toFixed(2)})`,
        )
      }

      if (endPadIdx === -1) {
        let closestDist = Infinity
        let closestIdx = -1
        let closestPoint = null
        for (let i = 0; i < route.route.length; i++) {
          const p = route.route[i]
          const dist = Math.sqrt((p.x - j.end.x) ** 2 + (p.y - j.end.y) ** 2)
          if (dist < closestDist) {
            closestDist = dist
            closestIdx = i
            closestPoint = p
          }
        }
        console.log(
          `  Closest point to end pad: idx=${closestIdx}, dist=${closestDist.toFixed(3)}, point=(${closestPoint?.x.toFixed(2)}, ${closestPoint?.y.toFixed(2)})`,
        )
      }
    }
  }
}
