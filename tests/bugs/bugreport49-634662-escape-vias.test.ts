import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport49-634662/bugreport49-634662.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver } from "../../lib"
import { EscapeViaLocationSolver } from "../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../lib/types"
import { isPointInRect } from "../../lib/utils/isPointInRect"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport49 adds escape via points for copper pour nets", () => {
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  const metadataByPointId = solver.getEscapeViaMetadataByPointId()

  const vcc = output.connections.find(
    (connection) => connection.name === "source_net_0",
  )
  const gnd = output.connections.find(
    (connection) => connection.name === "source_net_1",
  )

  expect(vcc).toBeDefined()
  expect(gnd).toBeDefined()

  const vccEscapePoints =
    vcc?.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("escape-via:"),
    ) ?? []
  const gndEscapePoints =
    gnd?.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("escape-via:"),
    ) ?? []

  expect(vccEscapePoints).toHaveLength(4)
  expect(gndEscapePoints).toHaveLength(1)

  expect(
    vcc?.externallyConnectedPointIds?.some(
      (group) =>
        group.length === 4 &&
        group.every((pointId) => pointId.startsWith("escape-via:")),
    ),
  ).toBe(true)

  for (const point of [...vccEscapePoints, ...gndEscapePoints]) {
    expect("layer" in point ? point.layer : null).toBe("top")

    const metadata = point.pointId
      ? metadataByPointId.get(point.pointId)
      : undefined
    expect(metadata).toBeDefined()

    const matchingPour = srj.obstacles.find(
      (obstacle) =>
        obstacle.isCopperPour &&
        obstacle.layers.includes(metadata!.targetLayer) &&
        isPointInRect(point, obstacle),
    )
    expect(matchingPour).toBeDefined()

    const topObstacleAtPoint = srj.obstacles.find(
      (obstacle) =>
        !obstacle.isCopperPour &&
        obstacle.layers.includes("top") &&
        isPointInRect(point, obstacle),
    )
    expect(topObstacleAtPoint).toBeUndefined()
  }
})

test("bugreport49 serializes VCC escape vias into the pour", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  const traces = solver
    .getOutputSimplifiedPcbTraces()
  const vccTraces = traces.filter((trace) => trace.connection_name === "net.VCC")
  const gndTraces = traces.filter((trace) => trace.connection_name === "net.GND")

  expect(
    vccTraces.some((trace) =>
      trace.route.some(
        (segment) =>
          segment.route_type === "via" && segment.to_layer === "inner1",
      ),
    ),
  ).toBe(true)
  expect(
    gndTraces.some((trace) =>
      trace.route.some(
        (segment) =>
          segment.route_type === "via" && segment.to_layer === "inner2",
      ),
    ),
  ).toBe(true)
})
