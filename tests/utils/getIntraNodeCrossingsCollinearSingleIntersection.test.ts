import { expect, test } from "bun:test"
import { getIntraNodeCrossings } from "../../lib/utils/getIntraNodeCrossings"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const parseNodeWithPortPointsJson = (json: string): NodeWithPortPoints =>
  JSON.parse(json) as NodeWithPortPoints

test("numCollinearConnectionIntersections marks a single crossing collinear route", () => {
  const node = parseNodeWithPortPointsJson(`
    {
      "capacityMeshNodeId": "collinear-single-intersection",
      "center": { "x": 0, "y": 0 },
      "width": 10,
      "height": 10,
      "availableZ": [0],
      "portPoints": [
        { "x": -5, "y": -5, "z": 0, "connectionName": "left_cross", "rootConnectionName": "left_cross" },
        { "x": -5, "y": 5, "z": 0, "connectionName": "left_cross", "rootConnectionName": "left_cross" },
        { "x": -5, "y": -5, "z": 0, "connectionName": "bottom_cross", "rootConnectionName": "bottom_cross" },
        { "x": 5, "y": -5, "z": 0, "connectionName": "bottom_cross", "rootConnectionName": "bottom_cross" }
      ]
    }
  `)

  const result = getIntraNodeCrossings(node)

  expect(result.numCollinearConnectionIntersections).toBe(1)
})
