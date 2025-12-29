import { expect, test } from "bun:test"
import { getIntraNodeCrossings } from "../../lib/utils/getIntraNodeCrossings"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const parseNodeWithPortPointsJson = (json: string): NodeWithPortPoints =>
  JSON.parse(json) as NodeWithPortPoints

test("numCollinearConnectionIntersections stays zero when collinear routes are disjoint", () => {
  const node = parseNodeWithPortPointsJson(`
    {
      "capacityMeshNodeId": "collinear-separated",
      "center": { "x": 0, "y": 0 },
      "width": 10,
      "height": 10,
      "availableZ": [0],
      "portPoints": [
        { "x": -5, "y": -4, "z": 0, "connectionName": "left_a", "rootConnectionName": "left_a" },
        { "x": -5, "y": -2, "z": 0, "connectionName": "left_a", "rootConnectionName": "left_a" },
        { "x": -5, "y": 2, "z": 0, "connectionName": "left_b", "rootConnectionName": "left_b" },
        { "x": -5, "y": 4, "z": 0, "connectionName": "left_b", "rootConnectionName": "left_b" }
      ]
    }
  `)

  const result = getIntraNodeCrossings(node)

  expect(result.numCollinearConnectionIntersections).toBe(0)
})
