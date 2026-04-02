import { test, expect } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"

const inputs = {
  nodePortPoints: [
    {
      capacityMeshNodeId: "cn118",
      portPoints: [
        {
          x: -10.078125,
          y: 4.6875,
          z: 0,
          connectionName: "conn1",
        },
        {
          x: -9.84375,
          y: 3.75,
          z: 0,
          connectionName: "conn1",
        },
      ],
      center: {
        x: -9.84375,
        y: 4.21875,
      },
      width: 0.9375,
      height: 0.9375,
    },
  ],
  colorMap: {
    conn1: "hsl(0, 100%, 50%)",
  },
}

test("highdensityoverlap1", () => {
  const solver = new HighDensitySolver(inputs)

  solver.solve()

  const solution1 = solver.routes[0]
  const route = solution1.route

  expect(route.length).toBe(4)
  expect(route[0]).toEqual({
    x: -10.078125,
    y: 4.6875,
    z: 0,
  })
  expect(route[3]).toEqual({
    x: -9.84375,
    y: 3.75,
    z: 0,
  })

  expect(route[1]!.x).toBeCloseTo(route[0]!.x)
  expect(route[1]!.y).toBeLessThan(route[0]!.y)

  expect(route[2]!.x).toBeCloseTo(route[3]!.x)
  expect(route[2]!.y).toBeGreaterThan(route[3]!.y)
})
