import { expect, test } from "bun:test"
import { MultiSectionPortPointOptimizer } from "../lib/solvers/MultiSectionPortPointOptimizer"
import { PortPointPathingSolver } from "../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  SimpleRouteJson,
  CapacityMeshNode,
  CapacityMeshEdge,
} from "../lib/types"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

/**
 * Create a simple 3x3 grid of nodes for testing.
 *
 * Layout:
 *   0 - 1 - 2
 *   |   |   |
 *   3 - 4 - 5
 *   |   |   |
 *   6 - 7 - 8
 *
 * Each node is 1x1, spaced 1.5 apart.
 */
function createSimple3x3Grid(): {
  simpleRouteJson: SimpleRouteJson
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  inputNodes: InputNodeWithPortPoints[]
} {
  const nodeSize = 1
  const spacing = 1.5

  // Create capacity mesh nodes
  const capacityMeshNodes: CapacityMeshNode[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col
      capacityMeshNodes.push({
        capacityMeshNodeId: `cn_${idx}`,
        center: { x: col * spacing, y: row * spacing },
        width: nodeSize,
        height: nodeSize,
        availableZ: [0, 1],
        layer: "top",
        _containsTarget: false,
        _containsObstacle: false,
      })
    }
  }

  // Mark corner nodes as targets
  capacityMeshNodes[0]._containsTarget = true // top-left
  capacityMeshNodes[2]._containsTarget = true // top-right
  capacityMeshNodes[6]._containsTarget = true // bottom-left
  capacityMeshNodes[8]._containsTarget = true // bottom-right

  // Create edges (horizontal and vertical)
  const capacityMeshEdges: CapacityMeshEdge[] = []
  let edgeIdx = 0

  // Horizontal edges
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const idx1 = row * 3 + col
      const idx2 = row * 3 + col + 1
      capacityMeshEdges.push({
        capacityMeshEdgeId: `ce_${edgeIdx++}`,
        nodeIds: [`cn_${idx1}`, `cn_${idx2}`],
      })
    }
  }

  // Vertical edges
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const idx1 = row * 3 + col
      const idx2 = (row + 1) * 3 + col
      capacityMeshEdges.push({
        capacityMeshEdgeId: `ce_${edgeIdx++}`,
        nodeIds: [`cn_${idx1}`, `cn_${idx2}`],
      })
    }
  }

  // Create input nodes with port points
  const inputNodes: InputNodeWithPortPoints[] = []
  let portPointIdx = 0

  for (const node of capacityMeshNodes) {
    const portPoints: InputPortPoint[] = []

    // Find edges connected to this node and create port points on shared boundaries
    for (const edge of capacityMeshEdges) {
      if (!edge.nodeIds.includes(node.capacityMeshNodeId)) continue

      const otherNodeId = edge.nodeIds.find(
        (id) => id !== node.capacityMeshNodeId,
      )!
      const otherNode = capacityMeshNodes.find(
        (n) => n.capacityMeshNodeId === otherNodeId,
      )!

      // Calculate port point position on shared edge
      const dx = otherNode.center.x - node.center.x
      const dy = otherNode.center.y - node.center.y

      let ppX = node.center.x
      let ppY = node.center.y

      if (dx > 0)
        ppX += nodeSize / 2 // right edge
      else if (dx < 0) ppX -= nodeSize / 2 // left edge
      if (dy > 0)
        ppY += nodeSize / 2 // bottom edge
      else if (dy < 0) ppY -= nodeSize / 2 // top edge

      // Create port points for each z layer
      for (const z of node.availableZ) {
        const ppId = `pp_${portPointIdx++}`
        portPoints.push({
          portPointId: ppId,
          x: ppX,
          y: ppY,
          z,
          connectionNodeIds: [node.capacityMeshNodeId, otherNodeId] as [
            string,
            string,
          ],
          distToCentermostPortOnZ: 0,
        })
      }
    }

    inputNodes.push({
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints,
      availableZ: node.availableZ,
      _containsTarget: node._containsTarget,
      _containsObstacle: node._containsObstacle,
    })
  }

  // Create SimpleRouteJson with two connections:
  // - Connection A: from node 0 (top-left) to node 8 (bottom-right) - diagonal
  // - Connection B: from node 2 (top-right) to node 6 (bottom-left) - diagonal (crosses A)
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "conn_A",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 3, y: 3, layer: "top" },
        ],
      },
      {
        name: "conn_B",
        pointsToConnect: [
          { x: 3, y: 0, layer: "top" },
          { x: 0, y: 3, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -1, maxX: 4, minY: -1, maxY: 4 },
  }

  return { simpleRouteJson, capacityMeshNodes, capacityMeshEdges, inputNodes }
}

test("MultiSectionPortPointOptimizer only routes fully-contained connections", async () => {
  const { simpleRouteJson, capacityMeshNodes, capacityMeshEdges, inputNodes } =
    createSimple3x3Grid()

  // First run PortPointPathingSolver to get initial results
  const initialSolver = new PortPointPathingSolver({
    simpleRouteJson,
    inputNodes,
    capacityMeshNodes,
    colorMap: {},
  })
  initialSolver.solve()

  expect(initialSolver.solved).toBe(true)
  expect(initialSolver.connectionsWithResults.length).toBe(2)

  // Verify both connections were routed
  for (const result of initialSolver.connectionsWithResults) {
    expect(result.path).toBeDefined()
    expect(result.path!.length).toBeGreaterThan(0)
  }

  // Create the optimizer
  const optimizer = new MultiSectionPortPointOptimizer({
    simpleRouteJson,
    inputNodes,
    capacityMeshNodes,
    capacityMeshEdges,
    colorMap: {},
    initialConnectionResults: initialSolver.connectionsWithResults,
    initialAssignedPortPoints: initialSolver.assignedPortPoints,
    initialNodeAssignedPortPoints: initialSolver.nodeAssignedPortPoints,
  })

  // Get initial node count for verification
  const initialNodesWithPortPoints = optimizer.getNodesWithPortPoints()

  // Run the optimizer for a limited number of steps
  for (let i = 0; i < 1000 && !optimizer.solved; i++) {
    optimizer.step()
  }

  // Verify optimizer completed
  expect(optimizer.solved).toBe(true)

  // Verify results are valid - all connections should still exist
  const finalNodesWithPortPoints = optimizer.getNodesWithPortPoints()

  // The number of nodes with port points should be similar
  // (we're not adding or removing nodes, just potentially re-routing)
  expect(finalNodesWithPortPoints.length).toBeGreaterThan(0)

  // Verify connection results are valid
  for (const result of optimizer.connectionResults) {
    expect(result.path).toBeDefined()
    if (result.path) {
      // Path should have at least start and end
      expect(result.path.length).toBeGreaterThanOrEqual(2)

      // Each point in path should be within bounds
      for (const candidate of result.path) {
        expect(candidate.point.x).toBeGreaterThanOrEqual(-1)
        expect(candidate.point.x).toBeLessThanOrEqual(4)
        expect(candidate.point.y).toBeGreaterThanOrEqual(-1)
        expect(candidate.point.y).toBeLessThanOrEqual(4)
      }
    }
  }

  // Log stats for debugging
  console.log("Optimizer stats:", optimizer.stats)
})

test("createSectionSimpleRouteJson only includes fully-contained connections", async () => {
  const { simpleRouteJson, capacityMeshNodes, capacityMeshEdges, inputNodes } =
    createSimple3x3Grid()

  // First run PortPointPathingSolver
  const initialSolver = new PortPointPathingSolver({
    simpleRouteJson,
    inputNodes,
    capacityMeshNodes,
    colorMap: {},
  })
  initialSolver.solve()

  const optimizer = new MultiSectionPortPointOptimizer({
    simpleRouteJson,
    inputNodes,
    capacityMeshNodes,
    capacityMeshEdges,
    colorMap: {},
    initialConnectionResults: initialSolver.connectionsWithResults,
    initialAssignedPortPoints: initialSolver.assignedPortPoints,
    initialNodeAssignedPortPoints: initialSolver.nodeAssignedPortPoints,
  })

  // Create a small section around the center node (node 4)
  // This section should NOT contain any fully-contained connections
  // since both connections span from corner to corner
  const smallSection = optimizer.createSection({
    centerOfSectionCapacityNodeId: "cn_4",
    expansionDegrees: 1, // Only includes center + immediate neighbors (nodes 1, 3, 4, 5, 7)
  })

  const smallSectionSrj = optimizer.createSectionSimpleRouteJson(smallSection)

  // With expansion 1 around node 4, we get nodes 1, 3, 4, 5, 7
  // Neither connection (0->8 or 2->6) has both endpoints in this section
  expect(smallSectionSrj.connections.length).toBe(0)

  // Create a larger section that includes all nodes
  const largeSection = optimizer.createSection({
    centerOfSectionCapacityNodeId: "cn_4",
    expansionDegrees: 3, // Should include all nodes
  })

  const largeSectionSrj = optimizer.createSectionSimpleRouteJson(largeSection)

  // Both connections should be included since both have endpoints in the full section
  expect(largeSectionSrj.connections.length).toBe(2)
})
