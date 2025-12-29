import { expect, test } from "bun:test"
import { getIntraNodeCrossings } from "../../lib/utils/getIntraNodeCrossings"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const parseNodeWithPortPointsJson = (json: string): NodeWithPortPoints =>
  JSON.parse(json) as NodeWithPortPoints

test("numCollinearConnectionIntersections counts each intersecting collinear route", () => {
  const node = parseNodeWithPortPointsJson(`
    {
      "capacityMeshNodeId": "collinear-multi-intersection",
      "center": { "x": 0, "y": 0 },
      "width": 10,
      "height": 10,
      "availableZ": [0],
      "portPoints": [
        { "x": -5, "y": -5, "z": 0, "connectionName": "left_a", "rootConnectionName": "left_a" },
        { "x": -5, "y": -3, "z": 0, "connectionName": "left_a", "rootConnectionName": "left_a" },
        { "x": -5, "y": -5, "z": 0, "connectionName": "cross_a", "rootConnectionName": "cross_a" },
        { "x": 5, "y": -5, "z": 0, "connectionName": "cross_a", "rootConnectionName": "cross_a" },

        { "x": -5, "y": -1, "z": 0, "connectionName": "left_b", "rootConnectionName": "left_b" },
        { "x": -5, "y": 1, "z": 0, "connectionName": "left_b", "rootConnectionName": "left_b" },
        { "x": -5, "y": 1, "z": 0, "connectionName": "cross_b", "rootConnectionName": "cross_b" },
        { "x": 5, "y": 5, "z": 0, "connectionName": "cross_b", "rootConnectionName": "cross_b" },

        { "x": -5, "y": 3, "z": 0, "connectionName": "left_c", "rootConnectionName": "left_c" },
        { "x": -5, "y": 5, "z": 0, "connectionName": "left_c", "rootConnectionName": "left_c" },
        { "x": -5, "y": 5, "z": 0, "connectionName": "cross_c", "rootConnectionName": "cross_c" },
        { "x": 5, "y": 5, "z": 0, "connectionName": "cross_c", "rootConnectionName": "cross_c" }
      ]
    }
  `)

  const result = getIntraNodeCrossings(node)

  expect(result.numCollinearConnectionIntersections).toBe(3)
})
