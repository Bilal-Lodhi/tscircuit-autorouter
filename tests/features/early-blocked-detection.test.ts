import { expect, test, describe } from "bun:test"
import { PortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

describe("Early blocked connection detection", () => {
  test("should detect blocked connection when end node is unreachable", () => {
    // Create a simple mesh with two isolated nodes (no port points connecting them)
    const node1: InputNodeWithPortPoints = {
      capacityMeshNodeId: "node1",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      portPoints: [],
      availableZ: [0],
      _containsTarget: true,
    }

    const node2: InputNodeWithPortPoints = {
      capacityMeshNodeId: "node2",
      center: { x: 100, y: 0 },
      width: 10,
      height: 10,
      portPoints: [],
      availableZ: [0],
      _containsTarget: true,
    }

    const capacityMeshNodes: CapacityMeshNode[] = [
      {
        capacityMeshNodeId: "node1",
        center: { x: 0, y: 0, z: 0 },
        width: 10,
        height: 10,
        layer: "top",
        availableCapacity: 1,
        usedCapacity: 0,
      },
      {
        capacityMeshNodeId: "node2",
        center: { x: 100, y: 0, z: 0 },
        width: 10,
        height: 10,
        layer: "top",
        availableCapacity: 1,
        usedCapacity: 0,
      },
    ]

    const simpleRouteJson: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [
        {
          name: "conn1",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 100, y: 0, layer: "top" },
          ],
        },
      ],
      bounds: { minX: -50, minY: -50, maxX: 150, maxY: 50 },
    }

    const solver = new PortPointPathingSolver({
      simpleRouteJson,
      inputNodes: [node1, node2],
      capacityMeshNodes,
      hyperParameters: {
        EARLY_BLOCKED_CHECK_MAX_HOPS: 10,
      },
    })

    // Run solver until it fails or completes
    solver.solve()

    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("blocked")
    expect(solver.error).toContain("not reachable")
  })

  test("should successfully route when end node is reachable", () => {
    // Create a mesh with connected nodes
    const portPoint: InputPortPoint = {
      portPointId: "pp1",
      x: 50,
      y: 0,
      z: 0,
      connectionNodeIds: ["node1", "node2"],
      distToCentermostPortOnZ: 0,
    }

    const node1: InputNodeWithPortPoints = {
      capacityMeshNodeId: "node1",
      center: { x: 0, y: 0 },
      width: 100,
      height: 10,
      portPoints: [portPoint],
      availableZ: [0],
      _containsTarget: true,
    }

    const node2: InputNodeWithPortPoints = {
      capacityMeshNodeId: "node2",
      center: { x: 100, y: 0 },
      width: 100,
      height: 10,
      portPoints: [portPoint],
      availableZ: [0],
      _containsTarget: true,
    }

    const capacityMeshNodes: CapacityMeshNode[] = [
      {
        capacityMeshNodeId: "node1",
        center: { x: 0, y: 0, z: 0 },
        width: 100,
        height: 10,
        layer: "top",
        availableCapacity: 1,
        usedCapacity: 0,
      },
      {
        capacityMeshNodeId: "node2",
        center: { x: 100, y: 0, z: 0 },
        width: 100,
        height: 10,
        layer: "top",
        availableCapacity: 1,
        usedCapacity: 0,
      },
    ]

    const simpleRouteJson: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [
        {
          name: "conn1",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 100, y: 0, layer: "top" },
          ],
        },
      ],
      bounds: { minX: -50, minY: -50, maxX: 150, maxY: 50 },
    }

    const solver = new PortPointPathingSolver({
      simpleRouteJson,
      inputNodes: [node1, node2],
      capacityMeshNodes,
      hyperParameters: {
        EARLY_BLOCKED_CHECK_MAX_HOPS: 10,
      },
    })

    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
  })

  test("checkReachabilityWithinHops returns correct hop count", () => {
    // Create a linear chain of 5 nodes
    const nodes: InputNodeWithPortPoints[] = []
    const portPoints: InputPortPoint[] = []

    for (let i = 0; i < 5; i++) {
      nodes.push({
        capacityMeshNodeId: `node${i}`,
        center: { x: i * 100, y: 0 },
        width: 10,
        height: 10,
        portPoints: [],
        availableZ: [0],
        _containsTarget: i === 0 || i === 4,
      })
    }

    // Create port points connecting adjacent nodes
    for (let i = 0; i < 4; i++) {
      const pp: InputPortPoint = {
        portPointId: `pp${i}`,
        x: (i + 0.5) * 100,
        y: 0,
        z: 0,
        connectionNodeIds: [`node${i}`, `node${i + 1}`],
        distToCentermostPortOnZ: 0,
      }
      portPoints.push(pp)
      nodes[i].portPoints.push(pp)
      nodes[i + 1].portPoints.push(pp)
    }

    const capacityMeshNodes: CapacityMeshNode[] = nodes.map((n) => ({
      capacityMeshNodeId: n.capacityMeshNodeId,
      center: { x: n.center.x, y: n.center.y, z: 0 },
      width: n.width,
      height: n.height,
      layer: "top",
      availableCapacity: 1,
      usedCapacity: 0,
    }))

    const simpleRouteJson: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      obstacles: [],
      connections: [
        {
          name: "conn1",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 400, y: 0, layer: "top" },
          ],
        },
      ],
      bounds: { minX: -50, minY: -50, maxX: 450, maxY: 50 },
    }

    const solver = new PortPointPathingSolver({
      simpleRouteJson,
      inputNodes: nodes,
      capacityMeshNodes,
      hyperParameters: {
        EARLY_BLOCKED_CHECK_MAX_HOPS: 10,
      },
    })

    // Test direct reachability check
    const result = solver.checkReachabilityWithinHops(
      "node0",
      "node4",
      10,
      "conn1",
    )
    expect(result.reachable).toBe(true)
    expect(result.hopsToReach).toBe(4)

    // Test with too few hops
    const resultLimited = solver.checkReachabilityWithinHops(
      "node0",
      "node4",
      2,
      "conn1",
    )
    expect(resultLimited.reachable).toBe(false)
  })
})
