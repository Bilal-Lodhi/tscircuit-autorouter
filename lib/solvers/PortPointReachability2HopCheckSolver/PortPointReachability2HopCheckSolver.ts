import type { HyperGraph } from "@tscircuit/hypergraph"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNodeId, Obstacle, SimpleRouteJson } from "lib/types"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { GraphicsObject } from "graphics-debug"
import { buildAdjacency } from "./graph/build-adjacency"
import { getEdgeKey } from "./graph/get-edge-key"
import { computeProgress } from "./progress/compute-progress"
import { resetCurrentObstacleTraversalState } from "./state/reset-current-obstacle-traversal-state"
import type { ObstacleResult, Phase } from "./types"
import { getVisualization } from "./visualization/get-visualization"
import { handleAssociateTargetsPhase } from "./phase/handle-associate-targets-phase"
import { handleBfsDegree0Phase } from "./phase/handle-bfs-degree0-phase"
import { handleBfsDegree1Phase } from "./phase/handle-bfs-degree1-phase"
import { handleBfsDegree2Phase } from "./phase/handle-bfs-degree2-phase"
import { handleFinalizeObstaclePhase } from "./phase/handle-finalize-obstacle-phase"
import { handleRetryWithCrammedPhase } from "./phase/handle-retry-with-crammed-phase"
import { handleSelectObstaclePhase } from "./phase/handle-select-obstacle-phase"

/**
 * Fast-check reachability pass for port-point pathing.
 *
 * This solver runs a strict BFS limited to depth 2 around each obstacle.
 */
export class PortPointReachability2HopCheckSolver extends BaseSolver {
  override getSolverName(): string {
    return "PortPointReachability2HopCheckSolver"
  }

  srj: SimpleRouteJson
  graph: HyperGraph
  inputNodes: InputNodeWithPortPoints[]
  connectionsWithResults: ConnectionPathResult[]
  connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>

  phase: Phase = "select_obstacle"
  currentObstacleIndex = 0
  orderedObstacleIndices: number[] = []
  results: ObstacleResult[] = []

  currentObstacle: Obstacle | null = null
  currentObstacleSrjIndex: number | null = null
  currentAnchorNodeId: CapacityMeshNodeId | null = null
  currentDiscoveredDepthByNodeId: Map<CapacityMeshNodeId, number> = new Map()
  currentDiscoveredDepthByEdgeKey: Map<string, number> = new Map()
  discoveredPortIdsByDegree: Map<0 | 1 | 2, Set<string>> = new Map([
    [0, new Set()],
    [1, new Set()],
    [2, new Set()],
  ])
  currentChokeBlockedAtDegree2 = false
  frontier: CapacityMeshNodeId[] = []
  frontierCursor = 0
  nextFrontier: CapacityMeshNodeId[] = []
  activeExpandDegree: 1 | 2 | null = null
  activeObstacleUsesCrammed = false

  usedCrammedPortPointIds = new Set<string>()
  currentUsedCrammedPortPointIds = new Set<string>()
  crammedPortPointsByEdgeKey = new Map<string, SegmentPortPoint[]>()
  crammedPortPointMap = new Map<string, SegmentPortPoint>()
  normalPortIdsByEdgeKey = new Map<string, string[]>()

  lastExpansion: {
    degree: 1 | 2
    fromNodeId: CapacityMeshNodeId
    toNodeId: CapacityMeshNodeId
    usedCrammed: boolean
  } | null = null

  adjacencyByNodeId = new Map<CapacityMeshNodeId, Set<CapacityMeshNodeId>>()

  get totalObstaclesToProcess(): number {
    return this.orderedObstacleIndices.length
  }

  constructor({
    srj,
    inputGraph,
    inputNodes,
    connectionsWithResults,
    connectionNameToGoalNodeIds,
    sharedEdges,
  }: {
    srj: SimpleRouteJson
    inputGraph: HyperGraph
    inputNodes: InputNodeWithPortPoints[]
    connectionsWithResults: ConnectionPathResult[]
    connectionNameToGoalNodeIds: Map<string, CapacityMeshNodeId[]>
    sharedEdges: SharedEdgeSegment[]
  }) {
    super()
    this.srj = srj
    this.graph = inputGraph
    this.inputNodes = inputNodes
    this.connectionsWithResults = connectionsWithResults
    this.connectionNameToGoalNodeIds = connectionNameToGoalNodeIds

    for (const sharedEdge of sharedEdges) {
      const [nodeId1, nodeId2] = sharedEdge.nodeIds
      const edgeKey = this.getEdgeKey(nodeId1, nodeId2)
      this.crammedPortPointsByEdgeKey.set(edgeKey, sharedEdge.crammedPortPoints)
      for (const pp of sharedEdge.crammedPortPoints) {
        this.crammedPortPointMap.set(pp.segmentPortPointId, pp)
      }
    }

    buildAdjacency(this)
    const targetNodeIds = new Set<CapacityMeshNodeId>(
      Array.from(this.connectionNameToGoalNodeIds.values()).flat(),
    )
    const targetObstacleNodeBoxes = this.inputNodes
      .filter(
        (node) =>
          targetNodeIds.has(node.capacityMeshNodeId) && node._containsObstacle,
      )
      .map((node) => ({
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      }))

    this.orderedObstacleIndices = this.srj.obstacles
      .map((obstacle, index) => ({
        index,
        x: obstacle.center.x,
        y: obstacle.center.y,
        minX: obstacle.center.x - obstacle.width / 2,
        maxX: obstacle.center.x + obstacle.width / 2,
        minY: obstacle.center.y - obstacle.height / 2,
        maxY: obstacle.center.y + obstacle.height / 2,
      }))
      .filter((obstacle) =>
        targetObstacleNodeBoxes.some((targetNode) =>
          this.boxesOverlap(obstacle, targetNode),
        ),
      )
      .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
      .map((entry) => entry.index)

    this.MAX_ITERATIONS = Math.max(1, this.totalObstaclesToProcess * 128)
  }

  /** Returns a stable key for an undirected graph edge. */
  getEdgeKey(nodeIdA: CapacityMeshNodeId, nodeIdB: CapacityMeshNodeId): string {
    return getEdgeKey(nodeIdA, nodeIdB)
  }

  /** Resets mutable traversal state for the active obstacle. */
  resetCurrentObstacleTraversalState(): void {
    resetCurrentObstacleTraversalState(this)
  }

  boxesOverlap(
    a: { minX: number; maxX: number; minY: number; maxY: number },
    b: { minX: number; maxX: number; minY: number; maxY: number },
  ): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    )
  }

  _step() {
    if (this.phase === "done") {
      this.solved = true
      return
    }

    if (this.currentObstacleIndex >= this.totalObstaclesToProcess) {
      this.phase = "done"
      this.solved = true
      return
    }

    switch (this.phase) {
      case "select_obstacle":
        handleSelectObstaclePhase(this)
        return
      case "associate_targets":
        handleAssociateTargetsPhase(this)
        return
      case "bfs_degree_0":
        handleBfsDegree0Phase(this)
        return
      case "bfs_degree_1":
        handleBfsDegree1Phase(this)
        return
      case "bfs_degree_2":
        handleBfsDegree2Phase(this)
        return
      case "retry_with_crammed":
        handleRetryWithCrammedPhase(this)
        return
      case "finalize_obstacle":
        handleFinalizeObstaclePhase(this)
        return
    }
  }

  computeProgress(): number {
    return computeProgress(this)
  }

  visualize(): GraphicsObject {
    return getVisualization(this)
  }
}
