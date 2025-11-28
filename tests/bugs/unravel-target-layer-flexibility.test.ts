import { describe, expect, test } from "bun:test"
import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import { createSegmentPointMap } from "lib/solvers/UnravelSolver/createSegmentPointMap"
import type { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type { SegmentId } from "lib/solvers/UnravelSolver/types"

describe("unravel multi-layer targets", () => {
  test("target nodes with multi-layer availability are mutable", () => {
    const nodeA: CapacityMeshNode = {
      capacityMeshNodeId: "nodeA",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "z0",
      availableZ: [0],
    }

    const nodeB: CapacityMeshNode = {
      capacityMeshNodeId: "nodeB",
      center: { x: 10, y: 0 },
      width: 2,
      height: 2,
      layer: "z0",
      availableZ: [0, 1],
      _containsTarget: true,
    }

    const nodeC: CapacityMeshNode = {
      capacityMeshNodeId: "nodeC",
      center: { x: -10, y: 0 },
      width: 2,
      height: 2,
      layer: "z0",
      availableZ: [0],
      _containsTarget: true,
    }

    const dedupedSegments: SegmentWithAssignedPoints[] = [
      {
        capacityMeshNodeId: "nodeA",
        nodePortSegmentId: "seg1",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        availableZ: [0, 1],
        connectionNames: ["net-ab"],
        assignedPoints: [
          {
            connectionName: "net-ab",
            point: { x: 5, y: 0, z: 0 },
          },
        ],
      },
      {
        capacityMeshNodeId: "nodeB",
        nodePortSegmentId: "seg2",
        start: { x: 10, y: 0 },
        end: { x: 12, y: 0 },
        availableZ: [0, 1],
        connectionNames: ["net-ab"],
        assignedPoints: [
          {
            connectionName: "net-ab",
            point: { x: 11, y: 0, z: 0 },
          },
        ],
      },
      {
        capacityMeshNodeId: "nodeA",
        nodePortSegmentId: "seg3",
        start: { x: 0, y: 0 },
        end: { x: -10, y: 0 },
        availableZ: [0],
        connectionNames: ["net-ac"],
        assignedPoints: [
          {
            connectionName: "net-ac",
            point: { x: -5, y: 0, z: 0 },
          },
        ],
      },
      {
        capacityMeshNodeId: "nodeC",
        nodePortSegmentId: "seg4",
        start: { x: -10, y: 0 },
        end: { x: -12, y: 0 },
        availableZ: [0],
        connectionNames: ["net-ac"],
        assignedPoints: [
          {
            connectionName: "net-ac",
            point: { x: -11, y: 0, z: 0 },
          },
        ],
      },
    ]

    const nodeIdToSegmentIds = new Map<CapacityMeshNodeId, SegmentId[]>([
      ["nodeA", ["seg1", "seg3"]],
      ["nodeB", ["seg1", "seg2"]],
      ["nodeC", ["seg3", "seg4"]],
    ])

    const segmentIdToNodeIds = new Map<SegmentId, CapacityMeshNodeId[]>([
      ["seg1", ["nodeA", "nodeB"]],
      ["seg2", ["nodeB"]],
      ["seg3", ["nodeA", "nodeC"]],
      ["seg4", ["nodeC"]],
    ])

    const maps = createSegmentPointMap(dedupedSegments, segmentIdToNodeIds)

    const solver = new UnravelSectionSolver({
      rootNodeId: "nodeA",
      nodeMap: new Map([
        [nodeA.capacityMeshNodeId, nodeA],
        [nodeB.capacityMeshNodeId, nodeB],
        [nodeC.capacityMeshNodeId, nodeC],
      ]),
      dedupedSegments,
      nodeIdToSegmentIds,
      segmentIdToNodeIds,
      segmentPointMap: maps.segmentPointMap,
      nodeToSegmentPointMap: maps.nodeToSegmentPointMap,
      segmentToSegmentPointMap: maps.segmentToSegmentPointMap,
      MUTABLE_HOPS: 0,
    })

    const segmentPointMap = solver.unravelSection.segmentPointMap
    const mutablePoints = solver.unravelSection.mutableSegmentPointIds

    const targetMultiLayerPoints =
      solver.unravelSection.segmentPointsInNode
        .get("nodeB")
        ?.filter((spId) => segmentPointMap.get(spId)?.segmentId === "seg2") ??
      []

    expect(targetMultiLayerPoints.length).toBeGreaterThan(0)
    for (const spId of targetMultiLayerPoints) {
      expect(mutablePoints.has(spId)).toBe(true)
    }

    const targetSingleLayerPoints =
      solver.unravelSection.segmentPointsInNode
        .get("nodeC")
        ?.filter((spId) => segmentPointMap.get(spId)?.segmentId === "seg4") ??
      []

    expect(targetSingleLayerPoints.length).toBeGreaterThan(0)
    for (const spId of targetSingleLayerPoints) {
      expect(mutablePoints.has(spId)).toBe(false)
    }
  })
})
