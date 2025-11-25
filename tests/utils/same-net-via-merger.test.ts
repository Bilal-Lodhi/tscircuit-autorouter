import { describe, expect, it } from "bun:test"
import { SameNetViaMerger } from "lib/solvers/SameNetViaMerger/SameNetViaMerger"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const buildRoute = (
  connectionName: string,
  viaX: number,
  viaY: number,
): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.6,
  vias: [{ x: viaX, y: viaY }],
  route: [
    { x: 0, y: 0, z: 0 },
    { x: viaX, y: viaY, z: 1 },
  ],
})

describe("SameNetViaMerger", () => {
  it("merges overlapping vias on the same net and updates routes", () => {
    const hdRoutes: HighDensityRoute[] = [
      buildRoute("connA_mst0", 1, 1),
      buildRoute("connA_mst1", 1.00005, 1.00005),
      buildRoute("connB", 1.00005, 1.00005),
    ]

    const merger = new SameNetViaMerger({
      hdRoutes,
      connections: [
        { name: "connA", netConnectionName: "NET1", pointsToConnect: [] },
        { name: "connB", pointsToConnect: [] },
      ] satisfies SimpleRouteConnection[],
    })

    merger.solve()

    const mergedRoutes = merger.mergedHdRoutes
    const expectedCanonical = (1 + 1.00005) / 2

    expect(merger.solved).toBeTrue()
    expect(mergedRoutes[0].vias[0].x).toBeCloseTo(expectedCanonical, 6)
    expect(mergedRoutes[1].vias[0].x).toBeCloseTo(expectedCanonical, 6)
    expect(mergedRoutes[0].route[1].x).toBeCloseTo(expectedCanonical, 6)
    expect(mergedRoutes[1].route[1].x).toBeCloseTo(expectedCanonical, 6)

    // Different net should not be merged with NET1 vias
    expect(mergedRoutes[2].vias[0].x).toBeCloseTo(1.00005, 6)
  })
})
