import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e3 from "examples/legacy/assets/e2e3.json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  createPortPointSection,
  visualizeSection,
} from "../lib/solvers/MultiSectionPortPointOptimizer"

test("should solve e2e3 board and produce valid SimpleRouteJson output", async () => {
  const simpleSrj: SimpleRouteJson = e2e3 as any

  const solver = new AutoroutingPipelineSolver(simpleSrj)

  solver.solve()

  expect(solver.availableSegmentPointSolver!.visualize()).toMatchGraphicsSvg(
    `${import.meta.path}-availableSegmentPointSolver`,
  )
  expect(solver.portPointPathingSolver!.visualize()).toMatchGraphicsSvg(
    `${import.meta.path}-portPointPathingSolver`,
  )

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 20_000)

test("createPortPointSection creates valid section from center node", async () => {
  const simpleSrj: SimpleRouteJson = e2e3 as any

  const solver = new AutoroutingPipelineSolver(simpleSrj)

  // Solve until we have the port point pathing solver ready
  solver.solveUntilPhase("multiSectionPortPointOptimizer")
  // Run the multiSectionPortPointOptimizer phase to completion
  while (solver.getCurrentPhase() === "multiSectionPortPointOptimizer") {
    solver.step()
  }

  const portPointSolver = solver.portPointPathingSolver!

  // Get a node from the center of the board to use as section center
  const nodes = portPointSolver.inputNodes
  expect(nodes.length).toBeGreaterThan(0)

  // Find a node near the center of the board
  const bounds = simpleSrj.bounds
  const boardCenterX = (bounds.minX + bounds.maxX) / 2
  const boardCenterY = (bounds.minY + bounds.maxY) / 2

  let closestNode = nodes[0]
  let closestDist = Infinity
  for (const node of nodes) {
    const dist = Math.sqrt(
      (node.center.x - boardCenterX) ** 2 +
        (node.center.y - boardCenterY) ** 2,
    )
    if (dist < closestDist) {
      closestDist = dist
      closestNode = node
    }
  }

  // Create a section with expansion degree 2 (2 hops from center)
  const section = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: closestNode.capacityMeshNodeId,
      expansionDegrees: 2,
    },
  )

  // Verify section structure
  expect(section.centerNodeId).toBe(closestNode.capacityMeshNodeId)
  expect(section.expansionDegrees).toBe(2)
  expect(section.nodeIds.size).toBeGreaterThan(0)
  expect(section.inputNodes.length).toBeGreaterThan(0)
  expect(section.capacityMeshNodes.length).toBeGreaterThan(0)

  // The center node should be in the section
  expect(section.nodeIds.has(closestNode.capacityMeshNodeId)).toBe(true)

  // Visualize the section
  const sectionViz = visualizeSection(section, solver.colorMap)
  expect(sectionViz).toMatchGraphicsSvg(
    `${import.meta.path}-section-expansion2`,
  )
}, 20_000)

test("createPortPointSection with different expansion degrees", async () => {
  const simpleSrj: SimpleRouteJson = e2e3 as any

  const solver = new AutoroutingPipelineSolver(simpleSrj)

  // Solve until we have the port point pathing solver ready
  solver.solveUntilPhase("multiSectionPortPointOptimizer")
  while (solver.getCurrentPhase() === "multiSectionPortPointOptimizer") {
    solver.step()
  }

  const portPointSolver = solver.portPointPathingSolver!

  // Use first node as center for predictable results
  const centerNode = portPointSolver.inputNodes[0]

  // Create sections with different expansion degrees
  const section0 = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: centerNode.capacityMeshNodeId,
      expansionDegrees: 0,
    },
  )

  const section1 = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: centerNode.capacityMeshNodeId,
      expansionDegrees: 1,
    },
  )

  const section3 = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: centerNode.capacityMeshNodeId,
      expansionDegrees: 3,
    },
  )

  // Expansion 0 should only contain the center node
  expect(section0.nodeIds.size).toBe(1)
  expect(section0.inputNodes.length).toBe(1)
  expect(section0.internalEdges.length).toBe(0) // No internal edges with just one node

  // Expansion 1 should contain more nodes than expansion 0
  expect(section1.nodeIds.size).toBeGreaterThan(section0.nodeIds.size)

  // Expansion 3 should contain more nodes than expansion 1
  expect(section3.nodeIds.size).toBeGreaterThanOrEqual(section1.nodeIds.size)

  // Visualize section with expansion 1
  expect(visualizeSection(section1, solver.colorMap)).toMatchGraphicsSvg(
    `${import.meta.path}-section-expansion1`,
  )

  // Visualize section with expansion 3
  expect(visualizeSection(section3, solver.colorMap)).toMatchGraphicsSvg(
    `${import.meta.path}-section-expansion3`,
  )
}, 20_000)
