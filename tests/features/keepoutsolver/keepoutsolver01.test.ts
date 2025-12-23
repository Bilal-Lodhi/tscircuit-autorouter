import { test, expect } from "bun:test"
import { TraceKeepoutSolver } from "lib/solvers/TraceKeepoutSolver/TraceKeepoutSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import input from "../../../examples/features/keepoutsolver/keepoutsolver01-input.json"

test("TraceKeepoutSolver - adjusts traces to maintain keepout distance", () => {
  const data = (input as any)[0]

  const connMap = new ConnectivityMap(data.connMap.netMap)

  const solver = new TraceKeepoutSolver({
    hdRoutes: data.hdRoutes,
    obstacles: data.obstacles,
    connMap,
    colorMap: data.colorMap,
    keepoutRadiusSchedule: data.keepoutRadiusSchedule,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getRedrawnHdRoutes().length).toBeGreaterThan(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
