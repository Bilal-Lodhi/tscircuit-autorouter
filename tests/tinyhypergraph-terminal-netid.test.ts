import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { buildSerializedTinyGraph } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

const createTinyTerminalFixture = (): HgPortPointPathingSolverParams => {
  const startRegion: HgPortPointPathingSolverParams["graph"]["regions"][number] =
    {
      regionId: "start",
      d: {
        capacityMeshNodeId: "start",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layer: "top",
        availableZ: [0],
      },
      ports: [],
    }
  const endRegion: HgPortPointPathingSolverParams["graph"]["regions"][number] =
    {
      regionId: "end",
      d: {
        capacityMeshNodeId: "end",
        center: { x: 2, y: 0 },
        width: 1,
        height: 1,
        layer: "top",
        availableZ: [0],
      },
      ports: [],
    }
  const throughPort: HgPortPointPathingSolverParams["graph"]["ports"][number] =
    {
      portId: "through",
      region1: startRegion,
      region2: endRegion,
      d: {
        portId: "through::0",
        x: 1,
        y: 0,
        z: 0,
        distToCentermostPortOnZ: 0,
        regions: [startRegion, endRegion],
      },
    }

  startRegion.ports.push(throughPort)
  endRegion.ports.push(throughPort)

  return {
    graph: {
      regions: [startRegion, endRegion],
      ports: [throughPort],
    },
    connections: [
      {
        connectionId: "conn1",
        mutuallyConnectedNetworkId: "net1",
        startRegion,
        endRegion,
        simpleRouteConnection: {
          name: "conn1",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 2, y: 0, layer: "top" },
          ],
        },
      },
    ],
    layerCount: 2,
    effort: 1,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
    },
    weights: {
      SHUFFLE_SEED: 0,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      GREEDY_MULTIPLIER: 0,
      NODE_PF_FACTOR: 0,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0,
      NODE_PF_MAX_PENALTY: 0,
      MEMORY_PF_FACTOR: 0,
      BASE_CANDIDATE_COST: 0,
      MIN_ALLOWED_BOARD_SCORE: 0,
      MAX_ITERATIONS_PER_PATH: 0,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0,
      END_RIPPING_PF_THRESHOLD: 0,
      MAX_RIPS: 0,
      RANDOM_RIP_FRACTION: 0,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
    },
  }
}

test("pipeline4 tiny graph generation does not emit free one-port endpoint regions", () => {
  const serializedGraph = buildSerializedTinyGraph(createTinyTerminalFixture())
  const terminalRegions = serializedGraph.regions.filter(
    (region) => region.d?._tinyTerminal === true,
  )
  const serializedConnection = serializedGraph.connections?.[0] as
    | (NonNullable<typeof serializedGraph.connections>[number] & {
        startPortId?: string
        endPortId?: string
      })
    | undefined

  expect(terminalRegions).toHaveLength(2)
  expect(serializedConnection?.startPortId).toBe(
    "tiny-terminal:start-port:conn1",
  )
  expect(serializedConnection?.endPortId).toBe("tiny-terminal:end-port:conn1")
  for (const region of terminalRegions) {
    expect(region.pointIds).toHaveLength(1)
    expect(region.d?.netId).toBe(0)
  }

  const loaded = loadSerializedHyperGraph(serializedGraph)
  const tinySolver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  const startPortId = loaded.problem.routeStartPort[0]!
  const startingNextRegionId = tinySolver.getStartingNextRegionId(
    0,
    startPortId,
  )
  const startingNextRegion =
    loaded.topology.regionMetadata?.[startingNextRegionId!]

  expect(startingNextRegion?.capacityMeshNodeId).toBe("start")
})
