import { describe, expect, test } from "bun:test"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  cloneNodeWithPortPoints,
  getInteractiveHighDensitySolveNode,
} from "lib/testing/utils/interactiveHighDensityNode"

const makeNode = (
  capacityMeshNodeId: string,
  connectionNamePrefix: string,
): NodeWithPortPoints => ({
  capacityMeshNodeId,
  center: { x: 1, y: 2 },
  width: 3,
  height: 4,
  availableZ: [0, 2],
  portPoints: [
    {
      portPointId: `${connectionNamePrefix}_0`,
      connectionName: `${connectionNamePrefix}_0`,
      rootConnectionName: `${connectionNamePrefix}_0`,
      x: 0.5,
      y: -2,
      z: 0,
    },
    {
      portPointId: `${connectionNamePrefix}_1`,
      connectionName: `${connectionNamePrefix}_0`,
      rootConnectionName: `${connectionNamePrefix}_0`,
      x: -0.5,
      y: 2,
      z: 2,
    },
  ],
})

describe("interactiveHighDensityNode", () => {
  test("cloneNodeWithPortPoints creates a deep clone of nested node data", () => {
    const originalNode = makeNode("cmn_original", "source_net")
    const clonedNode = cloneNodeWithPortPoints(originalNode)

    expect(clonedNode).not.toBe(originalNode)
    expect(clonedNode.center).not.toBe(originalNode.center)
    expect(clonedNode.availableZ).not.toBe(originalNode.availableZ)
    expect(clonedNode.portPoints).not.toBe(originalNode.portPoints)
    expect(clonedNode.portPoints[0]).not.toBe(originalNode.portPoints[0])

    clonedNode.center.x = 999
    clonedNode.availableZ?.push(4)
    clonedNode.portPoints[0]!.x = 999

    expect(originalNode.center.x).toBe(1)
    expect(originalNode.availableZ).toEqual([0, 2])
    expect(originalNode.portPoints[0]!.x).toBe(0.5)
  })

  test("getInteractiveHighDensitySolveNode returns the raw uploaded node when bypassing the editor", () => {
    const uploadedNode = makeNode("cmn_uploaded", "uploaded")
    const editedNode = makeNode("interactive-node", "edited")

    expect(
      getInteractiveHighDensitySolveNode({
        source: "uploaded",
        uploadedNode,
        editedNode,
      }),
    ).toBe(uploadedNode)

    expect(
      getInteractiveHighDensitySolveNode({
        source: "edited",
        uploadedNode,
        editedNode,
      }),
    ).toBe(editedNode)
  })
})
