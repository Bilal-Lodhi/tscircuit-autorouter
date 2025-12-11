import { describe, expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { SingleLayerNodeSplitterSolver } from "lib/solvers/SingleLayerNodeSplitter/SingleLayerNodeSplitterSolver"
import type { CapacityMeshNode } from "lib/types"

describe("SingleLayerNodeSplitterSolver", () => {
  const baseNode: CapacityMeshNode = {
    capacityMeshNodeId: "node-1",
    center: { x: 0, y: 0 },
    width: 6,
    height: 4,
    layer: "top",
    availableZ: [0],
  }

  test("splits single-layer nodes into bounded sizes", () => {
    const solver = new SingleLayerNodeSplitterSolver({
      nodes: [baseNode],
      minSingleLayerNodeSize: 2,
      maxSingleLayerNodeSize: 4,
    })

    solver.step()

    expect(solver.newNodes.length).toBeGreaterThan(1)
    solver.newNodes.forEach((node) => {
      expect(node.width).toBeGreaterThanOrEqual(2)
      expect(node.width).toBeLessThanOrEqual(4)
      expect(node.height).toBeGreaterThanOrEqual(2)
      expect(node.height).toBeLessThanOrEqual(4)
      expect(node.availableZ).toEqual([0])
    })

    const totalArea = solver.newNodes.reduce(
      (sum, node) => sum + node.width * node.height,
      0,
    )
    expect(totalArea).toBeCloseTo(baseNode.width * baseNode.height)
  })

  test("keeps multi-layer nodes intact", () => {
    const multiLayerNode: CapacityMeshNode = {
      ...baseNode,
      availableZ: [0, 1],
      capacityMeshNodeId: "multi",
    }

    const solver = new SingleLayerNodeSplitterSolver({
      nodes: [multiLayerNode],
      minSingleLayerNodeSize: 2,
      maxSingleLayerNodeSize: 4,
    })

    solver.step()

    expect(solver.newNodes).toHaveLength(1)
    expect(solver.newNodes[0]).toMatchObject(multiLayerNode)
  })
})

describe("AutoroutingPipelineSolver single-layer node sizing", () => {
  test("computes min and max single-layer node sizes from trace width and obstacle margin", () => {
    const srj = {
      layerCount: 2,
      minTraceWidth: 0.25,
      obstacleMargin: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    }

    const solver = new AutoroutingPipelineSolver(srj as any)
    expect(solver.minSingleLayerNodeSize).toBeCloseTo(0.4)
    expect(solver.maxSingleLayerNodeSize).toBeCloseTo(0.8)

    const stageNames = solver.pipelineDef.map((step) => step.solverName)
    const nodeSolverIndex = stageNames.indexOf("nodeSolver")
    const splitterIndex = stageNames.indexOf("singleLayerNodeSplitter")

    expect(splitterIndex).toBeGreaterThan(nodeSolverIndex)
  })
})
