import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "../lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"

type Point2D = { x: number; y: number }

type RoutePoint = Point2D & { z?: number; layer?: string; route_type?: string }

const EPS = 1e-6

const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y)

const triangleArea2 = (a: Point2D, b: Point2D, c: Point2D) =>
  Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))

const describePoint = (p: RoutePoint) =>
  `(${p.x.toFixed(6)}, ${p.y.toFixed(6)}${typeof p.z === "number" ? `, z=${p.z}` : ""}${p.layer ? `, layer=${p.layer}` : ""})`

const srj = dataset01.circuit011
const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj)
solver.solve()

console.log("=== dataset01 / circuit011 / Solver3 debug ===")
console.log("trace count:", solver.getOutputSimpleRouteJson().traces.length)

const node25 = solver.capacityNodes?.find((n) => n.capacityMeshNodeId === "cmn_25")
if (!node25) {
  console.log("cmn_25 not found in capacity nodes")
  process.exit(0)
}

const node25Bounds = {
  minX: node25.center.x - node25.width / 2,
  maxX: node25.center.x + node25.width / 2,
  minY: node25.center.y - node25.height / 2,
  maxY: node25.center.y + node25.height / 2,
}

console.log("cmn_25 bounds:", node25Bounds)

const solvedRoutes = solver.portPointPathingSolver?.solvedRoutes ?? []
const routesThrough25 = solvedRoutes.filter((route) =>
  route.path.some((step) => step.nextRegion?.regionId === "cmn_25"),
)

console.log("connections whose hypergraph path traverses cmn_25:")
for (const route of routesThrough25) {
  const name = route.connection.simpleRouteConnection.name
  const regionPath = route.path
    .map((step) => step.nextRegion?.regionId)
    .filter(Boolean)
    .join(" -> ")
  console.log(`- ${name}: ${regionPath}`)
}

const traces = solver.getOutputSimpleRouteJson().traces

const tinyTriangleCandidates: Array<{
  traceId: string
  index: number
  points: [RoutePoint, RoutePoint, RoutePoint]
  chordLength: number
  area2: number
}> = []

for (const trace of traces) {
  const wirePoints = trace.route.filter((p) => p.route_type === "wire") as RoutePoint[]

  for (let i = 0; i < wirePoints.length - 2; i++) {
    const a = wirePoints[i]
    const b = wirePoints[i + 1]
    const c = wirePoints[i + 2]

    const chordLength = distance(a, c)
    const area2 = triangleArea2(a, b, c)

    const hasSmallDetour = chordLength < 0.08 && area2 > EPS
    if (hasSmallDetour) {
      tinyTriangleCandidates.push({
        traceId: trace.pcb_trace_id,
        index: i,
        points: [a, b, c],
        chordLength,
        area2,
      })
    }
  }
}

console.log("tiny triangle candidates in final simplified traces:", tinyTriangleCandidates.length)
for (const candidate of tinyTriangleCandidates) {
  const [a, b, c] = candidate.points
  console.log(
    `- ${candidate.traceId} at i=${candidate.index}, chord=${candidate.chordLength.toFixed(6)}, area2=${candidate.area2.toExponential(2)}`,
  )
  console.log(`  a=${describePoint(a)}`)
  console.log(`  b=${describePoint(b)}`)
  console.log(`  c=${describePoint(c)}`)
}

// Determine at which stage the most obvious kink appears.
const target = { x: 0.75, y: -4.205 }
const stageRoutes: Array<[string, Array<{ connectionName: string; route: RoutePoint[] }>]> = [
  ["highDensityRouteSolver", solver.highDensityRouteSolver?.routes ?? []],
  ["highDensityStitchSolver", solver.highDensityStitchSolver?.mergedHdRoutes ?? []],
  ["traceSimplificationSolver", solver.traceSimplificationSolver?.simplifiedHdRoutes ?? []],
  ["traceWidthSolver", solver.traceWidthSolver?.getHdRoutesWithWidths() ?? []],
]

console.log("stage presence of kink point (0.75, -4.205):")
for (const [stageName, routes] of stageRoutes) {
  const hits = routes.filter((route) =>
    route.route.some(
      (point) => Math.abs(point.x - target.x) < EPS && Math.abs(point.y - target.y) < EPS,
    ),
  )
  console.log(`- ${stageName}: ${hits.length} route(s)`)
  for (const hit of hits) {
    console.log(`  -> ${hit.connectionName}`)
  }
}

console.log("Conclusion: the detour is already present in raw intra-node output from highDensityRouteSolver, not introduced by later stitching/simplification.")
