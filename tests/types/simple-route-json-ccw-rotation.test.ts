import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

test("SimpleRouteJson accepts optional ccwRotationDegrees", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    ccwRotationDegrees: 90,
    obstacles: [],
    connections: [],
    bounds: {
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 5,
    },
  }

  expect(srj.ccwRotationDegrees).toBe(90)
})
