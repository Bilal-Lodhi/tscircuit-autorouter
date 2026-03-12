import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "../../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"

const EPS = 1e-6

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

const triangleArea2 = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))

test("dataset01 circuit011 solver3 output should not contain tiny wire triangle detours", () => {
  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(dataset01.circuit011)
  solver.solve()

  const traces = solver.getOutputSimpleRouteJson().traces
  const tinyTriangles: Array<{ traceId: string; index: number }> = []

  for (const trace of traces) {
    const wirePoints = trace.route.filter((p) => p.route_type === "wire")
    for (let i = 0; i < wirePoints.length - 2; i++) {
      const a = wirePoints[i]
      const b = wirePoints[i + 1]
      const c = wirePoints[i + 2]

      if (a.layer !== b.layer || b.layer !== c.layer) continue

      const chord = distance(a, c)
      const area2 = triangleArea2(a, b, c)
      if (chord < 0.08 && area2 > EPS) {
        tinyTriangles.push({ traceId: trace.pcb_trace_id, index: i })
      }
    }
  }

  expect(tinyTriangles).toEqual([])
})
