import { expect, test } from "bun:test"
import { getConnectionsWithNodes } from "lib/solvers/PortPointPathingSolver/getConnectionsWithNodes"
import type { SimpleRouteJson } from "lib/types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

test("getConnectionsWithNodes prefers node box distance over center distance", () => {
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    minViaDiameter: 0.4,
    obstacles: [],
    connections: [
      {
        name: "conn-1",
        pointsToConnect: [
          { x: 2.1, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "top" },
        ],
      },
    ],
  }

  const inputNodes: InputNodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "A",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [],
      _containsTarget: true,
    },
    {
      capacityMeshNodeId: "B",
      center: { x: 5, y: 0 },
      width: 6,
      height: 2,
      availableZ: [0, 1],
      portPoints: [],
      _containsTarget: true,
    },
  ]

  const { unshuffledConnectionsWithResults } = getConnectionsWithNodes(
    simpleRouteJson,
    inputNodes,
  )

  expect(unshuffledConnectionsWithResults[0].nodeIds[0]).toBe("B")
})
