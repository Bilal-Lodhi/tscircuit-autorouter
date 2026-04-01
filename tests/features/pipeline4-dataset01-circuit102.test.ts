import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const getCircuit102 = () =>
  (dataset01 as Record<string, unknown>).circuit102 as SimpleRouteJson

const getNodeOrThrow = (
  nodes: NodeWithPortPoints[] | undefined,
  nodeId: string,
) => {
  const node = nodes?.find((candidate) => candidate.capacityMeshNodeId === nodeId)
  expect(node).toBeDefined()
  return node!
}

test(
  "pipeline4 dataset01 circuit102 solves cmn_159 directly with the single-layer no-different-root-intersection solver",
  () => {
    getGlobalInMemoryCache().clearCache()

    const defaultSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
    )
    defaultSolver.solve()

    expect(defaultSolver.solved).toBe(true)
    expect(defaultSolver.failed).toBe(false)
    expect(defaultSolver.error).toBeNull()

    const defaultMetadata =
      defaultSolver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_159")
    const defaultNode = getNodeOrThrow(
      defaultSolver.highDensityNodePortPoints,
      "cmn_159",
    )

    expect(defaultMetadata?.status).toBe("solved")
    expect(defaultMetadata?.solverType).toBe(
      "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver",
    )
    expect(defaultNode.portPoints.length).toBe(8)
    expect(
      new Set(defaultNode.portPoints.map((point) => point.connectionName)).size,
    ).toBe(3)

    getGlobalInMemoryCache().clearCache()

    const effort2Solver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { effort: 2 },
    )
    effort2Solver.solve()

    expect(effort2Solver.solved).toBe(true)
    expect(effort2Solver.failed).toBe(false)

    const effort2Metadata =
      effort2Solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_159")
    const effort2Node = getNodeOrThrow(
      effort2Solver.highDensityNodePortPoints,
      "cmn_159",
    )

    expect(effort2Metadata?.status).toBe("solved")
    expect(effort2Node.portPoints.length).toBe(4)
    expect(
      new Set(effort2Node.portPoints.map((point) => point.connectionName)).size,
    ).toBe(2)
    expect(
      JSON.stringify(effort2Node.portPoints.map((point) => point.connectionName)),
    ).not.toBe(
      JSON.stringify([
        "source_net_6_mst2",
        "source_net_6_mst2",
        "source_net_3_mst1",
        "source_net_3_mst1",
        "source_net_3_mst1",
        "source_net_3_mst1",
        "source_net_2_mst1",
        "source_net_2_mst1",
      ]),
    )
    expect(
      effort2Metadata?.solverType,
    ).toBe("SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost")
  },
  { timeout: 120_000 },
)
