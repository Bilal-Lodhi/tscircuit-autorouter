import { expect, test, describe } from "bun:test"
import {
  preprocessIntraNodeCrossings,
  getIntraNodeCrossingsFast,
  hasAnySameLayerCrossing,
  type NodeWithCrossingPrecompute,
  type PortPointAssignment,
} from "../../lib/utils/getIntraNodeCrossingsFast"
import type { InputPortPoint } from "../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

describe("getIntraNodeCrossingsFast", () => {
  function createTestNode(portPoints: Array<{ x: number; y: number; z: number }>): NodeWithCrossingPrecompute {
    const inputPortPoints: InputPortPoint[] = portPoints.map((pp, i) => ({
      portPointId: `pp${i}`,
      x: pp.x,
      y: pp.y,
      z: pp.z,
      connectionNodeIds: ["node1", "node2"],
      distToCentermostPortOnZ: 0,
    }))

    return {
      capacityMeshNodeId: "node1",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      portPoints: inputPortPoints,
      availableZ: [0, 1],
    }
  }

  test("detects simple crossing between two segments", () => {
    // Create 4 port points forming an X pattern
    // Segment 0-1: (0,0) to (10,10) - diagonal
    // Segment 2-3: (0,10) to (10,0) - cross diagonal
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 0, z: 0 },
    ])

    preprocessIntraNodeCrossings(node)

    // Net 0 connects port points 0 and 1
    // Net 1 connects port points 2 and 3
    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]

    const result = getIntraNodeCrossingsFast(node, assignment)
    expect(result.numSameLayerCrossings).toBe(1)
    expect(result.numEntryExitLayerChanges).toBe(0)
    expect(result.numTransitionPairCrossings).toBe(0)
  })

  test("no crossing when segments don't intersect", () => {
    // Two parallel segments
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 5, z: 0 },
      { x: 10, y: 5, z: 0 },
    ])

    preprocessIntraNodeCrossings(node)

    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]

    const result = getIntraNodeCrossingsFast(node, assignment)
    expect(result.numSameLayerCrossings).toBe(0)
  })

  test("no crossing when segments are on different z layers", () => {
    // X pattern but on different layers
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 1 }, // different z
      { x: 10, y: 0, z: 1 }, // different z
    ])

    preprocessIntraNodeCrossings(node)

    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]

    const result = getIntraNodeCrossingsFast(node, assignment)
    expect(result.numSameLayerCrossings).toBe(0)
  })

  test("hasAnySameLayerCrossing returns true for crossing segments", () => {
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 0, z: 0 },
    ])

    preprocessIntraNodeCrossings(node)

    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]

    expect(hasAnySameLayerCrossing(node, assignment)).toBe(true)
  })

  test("hasAnySameLayerCrossing returns false for non-crossing segments", () => {
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 5, z: 0 },
      { x: 10, y: 5, z: 0 },
    ])

    preprocessIntraNodeCrossings(node)

    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]

    expect(hasAnySameLayerCrossing(node, assignment)).toBe(false)
  })

  test("ignores same-net crossings", () => {
    // Four port points for a single net (forms an X)
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 0, z: 0 },
    ])

    preprocessIntraNodeCrossings(node)

    // All same net (net 0)
    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]

    const result = getIntraNodeCrossingsFast(node, assignment)
    // Same-net crossings should be subtracted
    expect(result.numSameLayerCrossings).toBe(0)
  })

  test("handles transition segments", () => {
    // Two segments that cross, but endpoints on different z
    const node = createTestNode([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 10, z: 1 }, // transition
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 0, z: 1 }, // transition
    ])

    preprocessIntraNodeCrossings(node)

    const assignment: PortPointAssignment = [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]

    const result = getIntraNodeCrossingsFast(node, assignment)
    expect(result.numSameLayerCrossings).toBe(0)
    expect(result.numEntryExitLayerChanges).toBe(2) // two transition segments
    expect(result.numTransitionPairCrossings).toBe(1) // they cross
  })
})
