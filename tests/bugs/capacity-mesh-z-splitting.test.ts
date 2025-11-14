import { describe, expect, test } from "bun:test"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

describe("CapacityMeshNodeSolver2_NodeUnderObstacle", () => {
  test("merges unobstructed layers above single-layer obstacle", () => {
    const srj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.2,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 5, y: 5 },
          width: 1,
          height: 1,
          connectedTo: [],
        },
      ],
    }

    const solver = new CapacityMeshNodeSolver2_NodeUnderObstacle(srj)
    solver.solve()

    const obstacle = srj.obstacles[0]
    const obsLeft = obstacle.center.x - obstacle.width / 2
    const obsRight = obstacle.center.x + obstacle.width / 2
    const obsBottom = obstacle.center.y - obstacle.height / 2
    const obsTop = obstacle.center.y + obstacle.height / 2

    const overlappingNodes = solver.finishedNodes.filter((node) => {
      const nodeLeft = node.center.x - node.width / 2
      const nodeRight = node.center.x + node.width / 2
      const nodeBottom = node.center.y - node.height / 2
      const nodeTop = node.center.y + node.height / 2
      return (
        nodeLeft < obsRight &&
        nodeRight > obsLeft &&
        nodeBottom < obsTop &&
        nodeTop > obsBottom
      )
    })

    const groups = new Map<string, CapacityMeshNode[]>()
    for (const node of overlappingNodes) {
      const key = [
        node.center.x.toFixed(4),
        node.center.y.toFixed(4),
        node.width.toFixed(4),
        node.height.toFixed(4),
      ].join(":")
      const list = groups.get(key)
      if (list) {
        list.push(node)
      } else {
        groups.set(key, [node])
      }
    }

    expect(groups.size).toBeGreaterThan(0)
    for (const [key, nodes] of groups.entries()) {
      expect(nodes.length).toBe(1)
      expect(nodes[0].availableZ).toEqual([1, 2, 3])
    }
  })
})
