import { describe, expect, it } from "bun:test"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

const createSolver = () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.25,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        zLayers: [0],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: [],
      },
    ],
    connections: [],
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  }

  return new CapacityMeshNodeSolver2_NodeUnderObstacle(srj)
}

describe("CapacityMeshNodeSolver2_NodeUnderObstacle", () => {
  it("merges available layers above a single-layer obstacle", () => {
    const solver = createSolver()

    const node: CapacityMeshNode = {
      capacityMeshNodeId: "test-node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0, 1, 2, 3],
      _depth: 1,
      _containsObstacle: true,
      _completelyInsideObstacle: false,
    }

    const zSubNodes = solver.getZSubdivisionChildNodes(node)

    expect(zSubNodes).toHaveLength(1)
    expect(zSubNodes[0]?.availableZ).toEqual([1, 2, 3])
  })
})
