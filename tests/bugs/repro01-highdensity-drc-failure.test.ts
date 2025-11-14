import { test, expect } from "bun:test"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import node from "../../examples/legacy/assets/cn11081-nodeWithPortPoints.json" assert {
  type: "json",
}
import { createSrjFromNodeWithPortPoints } from "lib/utils/createSrjFromNodeWithPortPoints"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"

const nodeWithPortPoints = (node as any).nodeWithPortPoints

test("cn11081 single transition solver routes without DRC errors", () => {
  const srj = createSrjFromNodeWithPortPoints(nodeWithPortPoints)
  const solver = new HyperSingleIntraNodeSolver({ nodeWithPortPoints })

  expect(srj).toMatchInlineSnapshot(`
    {
      "bounds": {
        "maxX": -2.21875,
        "maxY": 11.09375,
        "minX": -4.4375,
        "minY": 8.875,
      },
      "connections": [
        {
          "name": "source_trace_76",
          "pointsToConnect": [
            {
              "layer": "top",
              "x": -2.21875,
              "y": 10.81640625,
            },
            {
              "layer": "bottom",
              "x": -2.21875,
              "y": 9.70703125,
            },
          ],
        },
        {
          "name": "source_net_0_mst22",
          "pointsToConnect": [
            {
              "layer": "top",
              "x": -2.21875,
              "y": 10.26171875,
            },
            {
              "layer": "top",
              "x": -3.328125,
              "y": 11.09375,
            },
          ],
        },
      ],
      "layerCount": 2,
      "minTraceWidth": 0.1,
      "obstacles": [],
    }
  `)

  solver.solve()

  expect(solver.solved).toBe(true)

  const solverName = solver.winningSolver?.constructor.name

  // Convert routes to circuit json and run DRC
  const viaDiameter = solver.solvedRoutes[0]?.viaDiameter ?? 0.3
  const circuitJson = convertToCircuitJson(
    srj,
    solver.solvedRoutes,
    srj.minTraceWidth,
    viaDiameter,
  )
  expect(circuitJson).toMatchInlineSnapshot(`
    [
      {
        "connected_source_net_ids": [],
        "connected_source_port_ids": [],
        "source_trace_id": "source_trace_76",
        "type": "source_trace",
      },
      {
        "connected_source_net_ids": [],
        "connected_source_port_ids": [],
        "source_trace_id": "source_net_0",
        "type": "source_trace",
      },
      {
        "hole_diameter": 0.15,
        "layers": [
          "top",
          "bottom",
        ],
        "outer_diameter": 0.3,
        "pcb_trace_id": "trace_1",
        "pcb_via_id": "via_0",
        "type": "pcb_via",
        "x": -2.61875,
        "y": 10.8,
      },
      {
        "pcb_trace_id": "trace_0",
        "route": [
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.21875,
            "y": 10.26171875,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.2,
            "y": 10.200000000000001,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.6,
            "y": 10.200000000000001,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -3,
            "y": 10.200000000000001,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -3.4,
            "y": 10.600000000000001,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -3.328125,
            "y": 11.09375,
          },
        ],
        "source_trace_id": "source_net_0",
        "type": "pcb_trace",
      },
      {
        "pcb_trace_id": "trace_1",
        "route": [
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.21875,
            "y": 10.81640625,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.2,
            "y": 10.8,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.21875,
            "y": 10.8,
          },
          {
            "layer": "top",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.61875,
            "y": 10.8,
          },
          {
            "layer": "bottom",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.61875,
            "y": 10.8,
          },
          {
            "layer": "bottom",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.61875,
            "y": 10.4,
          },
          {
            "layer": "bottom",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.61875,
            "y": 10,
          },
          {
            "layer": "bottom",
            "route_type": "wire",
            "width": 0.1,
            "x": -2.21875,
            "y": 9.70703125,
          },
        ],
        "source_trace_id": "source_trace_76",
        "type": "pcb_trace",
      },
    ]
  `)
  const { errors } = getDrcErrors(circuitJson)

  expect(errors.length).toBe(0)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  expect(solverName).toMatchInlineSnapshot(`"CachedIntraNodeRouteSolver"`)
})
