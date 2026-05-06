import { expect, test } from "bun:test"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"

test("buildHyperGraph attaches boundary endpoints to routable adjacent regions", () => {
  const { connections } = buildHyperGraph({
    layerCount: 2,
    capacityMeshNodes: [
      {
        capacityMeshNodeId: "isolated_target",
        center: { x: 0, y: 0 },
        width: 0.1,
        height: 0.1,
        availableZ: [1],
        _containsTarget: true,
      },
      {
        capacityMeshNodeId: "routable_start",
        center: { x: 0.12, y: 0 },
        width: 0.1,
        height: 0.1,
        availableZ: [1],
      },
      {
        capacityMeshNodeId: "routable_end",
        center: { x: 0.24, y: 0 },
        width: 0.1,
        height: 0.1,
        availableZ: [1],
      },
    ] as any,
    segmentPortPoints: [
      {
        segmentPortPointId: "routable_port",
        x: 0.18,
        y: 0,
        availableZ: [1],
        nodeIds: ["routable_start", "routable_end"],
        edgeId: "edge_1",
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: false,
      },
    ],
    simpleRouteJsonConnections: [
      {
        name: "conn_1_reroute_trace_0",
        rootConnectionName: "conn_1",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom" },
          { x: 0.24, y: 0, layer: "bottom" },
        ],
      },
    ],
  })

  expect(connections[0]!.startRegion.regionId).toBe("routable_start")
  expect(connections[0]!.endRegion.regionId).toBe("routable_end")
})
