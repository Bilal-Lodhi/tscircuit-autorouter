import { expect, test } from "bun:test"
import {
  getRerouteSimpleRouteJson,
  reconnectReroutedSimpleRouteJsonRegion,
} from "lib/utils/getRerouteSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  obstacles: [],
  connections: [
    {
      name: "source_net_0",
      pointsToConnect: [
        { x: -5, y: 0, layer: "top" },
        { x: 5, y: 0, layer: "top" },
      ],
    },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "source_net_0_0",
      connection_name: "source_net_0",
      route: [
        { route_type: "wire", x: -5, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 5, y: 0, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "source_net_1_0",
      connection_name: "source_net_1",
      route: [
        { route_type: "wire", x: -5, y: 5, width: 0.15, layer: "top" },
        { route_type: "wire", x: 5, y: 5, width: 0.15, layer: "top" },
      ],
    },
  ],
}

test("getRerouteSimpleRouteJson clips traces out of a rectangular region", () => {
  const rerouted = getRerouteSimpleRouteJson(srj, {
    shape: "rect",
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  })

  expect(rerouted.connections).toHaveLength(1)
  expect(rerouted.bounds).toEqual({
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  })
  expect(rerouted.connections[0]?.rootConnectionName).toBe("source_net_0")
  expect(rerouted.connections[0]?.pointsToConnect).toEqual([
    { x: -1, y: 0, layer: "top" },
    { x: 1, y: 0, layer: "top" },
  ])
  expect(
    rerouted.obstacles.filter((obstacle) =>
      obstacle.obstacleId?.startsWith(
        "source_net_0_reroute_source_net_0_0_0_reroute_endpoint_",
      ),
    ),
  ).toHaveLength(2)

  const affectedTracePieces = rerouted.traces?.filter((trace) =>
    trace.pcb_trace_id.startsWith("source_net_0_0_keep_"),
  )
  expect(affectedTracePieces).toHaveLength(2)
  expect(
    rerouted.traces?.some((trace) => trace.pcb_trace_id === "source_net_1_0"),
  ).toBe(true)
})

test("getRerouteSimpleRouteJson keeps trace endpoints inside the region connectable", () => {
  const rerouted = getRerouteSimpleRouteJson(
    {
      ...srj,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "source_net_0_inside",
          connection_name: "source_net_0",
          route: [
            { route_type: "wire", x: -0.5, y: 0, width: 0.15, layer: "top" },
            { route_type: "wire", x: 0.5, y: 0, width: 0.15, layer: "top" },
          ],
        },
      ],
    },
    {
      shape: "rect",
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    },
  )

  expect(rerouted.connections).toHaveLength(1)
  expect(rerouted.connections[0]?.pointsToConnect).toEqual([
    { x: -0.5, y: 0, layer: "top" },
    { x: 0.5, y: 0, layer: "top" },
  ])
  expect(rerouted.traces).toHaveLength(0)
})

test("reconnectReroutedSimpleRouteJsonRegion restores original connections", () => {
  const rerouted = getRerouteSimpleRouteJson(srj, {
    shape: "rect",
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  })
  rerouted.traces?.push({
    type: "pcb_trace",
    pcb_trace_id: "rerouted_trace_0",
    connection_name: rerouted.connections[0]!.name,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
    ],
  })

  const reconnected = reconnectReroutedSimpleRouteJsonRegion(srj, rerouted)

  expect(reconnected.connections).toEqual(srj.connections)
  expect(
    reconnected.traces?.find(
      (trace) => trace.pcb_trace_id === "rerouted_trace_0",
    )?.connection_name,
  ).toBe("source_net_0")
})
