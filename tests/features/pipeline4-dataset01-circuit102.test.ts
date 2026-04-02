import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const getCircuit102 = () =>
  (dataset01 as Record<string, unknown>).circuit102 as SimpleRouteJson

const getNodesByPrefix = (
  nodes: NodeWithPortPoints[] | undefined,
  prefix: string,
) => nodes?.filter((candidate) => candidate.capacityMeshNodeId.startsWith(prefix)) ?? []

test(
  "pipeline4 dataset01 circuit102 still routes when maxRectRatio splits cmn_159",
  () => {
    getGlobalInMemoryCache().clearCache()

    const defaultSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
    )
    defaultSolver.solve()

    expect(defaultSolver.solved).toBe(true)
    expect(defaultSolver.failed).toBe(false)
    expect(defaultSolver.error).toBeNull()
    expect(defaultSolver.maxRectRatio).toBe(2)

    const defaultNodes = getNodesByPrefix(
      defaultSolver.highDensityNodePortPoints,
      "cmn_159__sub_",
    )
    const defaultMetadata = Array.from(
      defaultSolver.highDensityRouteSolver?.nodeSolveMetadataById.entries() ??
        [],
    ).filter(([nodeId]) => nodeId.startsWith("cmn_159__sub_"))

    expect(defaultNodes).toHaveLength(2)
    expect(defaultNodes.map((node) => node.portPoints.length).sort()).toEqual([
      2,
      4,
    ])
    expect(defaultMetadata).toHaveLength(2)
    expect(defaultMetadata.every(([, metadata]) => metadata.status === "solved")).toBe(
      true,
    )

    getGlobalInMemoryCache().clearCache()

    const explicit8mmSolver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { maxNodeDimension: 8 },
    )
    explicit8mmSolver.solve()

    expect(explicit8mmSolver.solved).toBe(true)
    expect(explicit8mmSolver.failed).toBe(false)

    const explicit8mmNodes = getNodesByPrefix(
      explicit8mmSolver.highDensityNodePortPoints,
      "cmn_159__sub_",
    )

    expect(explicit8mmNodes).toHaveLength(2)
    expect(
      explicit8mmNodes.map((node) => node.portPoints.length).sort(),
    ).toEqual([2, 6])

    getGlobalInMemoryCache().clearCache()

    const effort2Solver = new AutoroutingPipelineSolver4(
      structuredClone(getCircuit102()),
      { effort: 2 },
    )
    effort2Solver.solve()

    expect(effort2Solver.solved).toBe(true)
    expect(effort2Solver.failed).toBe(false)

    const effort2Nodes = getNodesByPrefix(
      effort2Solver.highDensityNodePortPoints,
      "cmn_159__sub_",
    )

    expect(effort2Nodes).toHaveLength(2)
    expect(effort2Nodes.map((node) => node.portPoints.length).sort()).toEqual([
      2,
      4,
    ])
  },
  { timeout: 120_000 },
)
