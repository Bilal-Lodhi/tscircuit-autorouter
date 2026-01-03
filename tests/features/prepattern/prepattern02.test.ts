import { test, expect } from "bun:test"
import { JumperPrepatternSolver } from "lib/solvers/JumperPrepatternSolver"
import { distance } from "@tscircuit/math-utils"
import input from "../../../fixtures/features/jumper-high-density/jumper-high-density03-input.json" with {
  type: "json",
}

/**
 * Check if a route has disjoint segments (gaps between consecutive points).
 * A route is considered disjoint if any consecutive points are more than
 * GAP_THRESHOLD apart.
 */
function hasDisjointSegments(
  route: Array<{ x: number; y: number; z?: number }>,
  gapThreshold = 0.5,
): { isDisjoint: boolean; gaps: Array<{ index: number; distance: number }> } {
  const gaps: Array<{ index: number; distance: number }> = []

  for (let i = 0; i < route.length - 1; i++) {
    const dist = distance(route[i], route[i + 1])
    if (dist > gapThreshold) {
      gaps.push({ index: i, distance: dist })
    }
  }

  return {
    isDisjoint: gaps.length > 0,
    gaps,
  }
}

test(
  "JumperPrepatternSolver02 - solves prepattern routes",
  () => {
    const solver = new JumperPrepatternSolver({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      hyperParameters: input.hyperParameters as any,
      traceWidth: input.traceWidth,
    })

    solver.solve()

    expect(solver.solved).toBe(true)


    // Check for disjoint paths in the solved routes
    const disjointRoutes: Array<{
      connectionName: string
      gaps: Array<{ index: number; distance: number }>
    }> = []

    for (const route of solver.solvedRoutes) {
      const result = hasDisjointSegments(route.route)
      if (result.isDisjoint) {
        disjointRoutes.push({
          connectionName: route.connectionName,
          gaps: result.gaps,
        })
      }
    }

    // Fail if any routes have disjoint segments
    // Gap threshold of 4mm accounts for:
    // - 0603 jumper gaps (~1.65mm)
    // - 1206 jumper gaps (~3.2mm)
    // - Normal force-directed routing segments (up to 3-4mm)
    const GAP_THRESHOLD = 4.0
    const significantDisjointRoutes = disjointRoutes.filter((r) =>
      r.gaps.some((g) => g.distance > GAP_THRESHOLD),
    )

    if (significantDisjointRoutes.length > 0) {
      const details = significantDisjointRoutes
        .map(
          (r) =>
            `${r.connectionName}: ${r.gaps.filter((g) => g.distance > GAP_THRESHOLD).length} significant gap(s) at indices ${r.gaps.filter((g) => g.distance > GAP_THRESHOLD).map((g) => `${g.index} (dist=${g.distance.toFixed(2)})`).join(", ")}`,
        )
        .join("\n")
      console.log(`Significant gaps found (>${GAP_THRESHOLD}mm):\n${details}`)
      expect(significantDisjointRoutes).toEqual([])
    }

    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  },
  { timeout: 30_000 },
)
