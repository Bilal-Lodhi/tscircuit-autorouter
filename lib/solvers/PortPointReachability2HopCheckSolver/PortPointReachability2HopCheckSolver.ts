import type { HyperGraph } from "@tscircuit/hypergraph"
import { distance } from "@tscircuit/math-utils"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNodeId, Obstacle, SimpleRouteJson } from "lib/types"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

type Phase =
  | "select_obstacle"
  | "associate_targets"
  | "bfs_degree_0"
  | "bfs_degree_1"
  | "bfs_degree_2"
  | "retry_with_crammed"
  | "finalize_obstacle"
  | "done"

interface ObstacleResult {
  obstacleIndex: number
  obstacle: Obstacle
  anchorNodeId: CapacityMeshNodeId | null
  discoveredDepthByNodeId: Map<CapacityMeshNodeId, number>
  discoveredDepthByEdgeKey: Map<string, number>
  chokeBlockedAtDegree2: boolean
  usedCrammedPortPointIds: Set<string>
}

const DEGREE_0_COLOR = "rgba(255, 180, 0, 0.95)"
const DEGREE_1_COLOR = "rgba(0, 170, 255, 0.95)"
const DEGREE_2_COLOR = "rgba(160, 95, 255, 0.95)"
/**
 * Fast-check reachability pass for port-point pathing.
 *
 * This solver runs a strict BFS limited to depth 2 (degrees 0, 1, 2 only) on
 * the hypergraph and never attempts full routing/path optimization.
 *
 * Why depth 2 is sufficient here:
 * - In expected capacity-mesh / hypergraph layouts, immediately useful
 *   reachability around an obstacle center is usually captured by direct
 *   neighbors and neighbors-of-neighbors.
 * - This gives a fast sanity check before expensive solvers run.
 *
 * Visualization colors:
 * - Degree 0: edges discovered while processing degree-0 frontier
 * - Degree 1: edges discovered while processing degree-1 frontier
 * - Degree 2: edges discovered while processing degree-2 frontier
 */
export class PortPointReachability2HopCheckSolver extends BaseSolver {
  override getSolverName(): string {
    return "PortPointReachability2HopCheckSolver"
  }

  srj: SimpleRouteJson
  graph: HyperGraph
  inputNodes: InputNodeWithPortPoints[]
  connectionsWithResults: ConnectionPathResult[]

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
  crammedPortPointsByEdgeKey = new Map<
    string,
    SharedEdgeSegment["crammedPortPoints"]
  >()
  crammedPortPointMap = new Map<
    string,
    SharedEdgeSegment["crammedPortPoints"][number]
  >()
  normalPortIdsByEdgeKey = new Map<string, string[]>()

  lastExpansion: {
    degree: 1 | 2
    fromNodeId: CapacityMeshNodeId
    toNodeId: CapacityMeshNodeId
    usedCrammed: boolean
  } | null = null

  adjacencyByNodeId = new Map<CapacityMeshNodeId, Set<CapacityMeshNodeId>>()

  constructor({
    srj,
    inputGraph,
    inputNodes,
    connectionsWithResults,
    sharedEdges,
  }: {
    srj: SimpleRouteJson
    inputGraph: HyperGraph
    inputNodes: InputNodeWithPortPoints[]
    connectionsWithResults: ConnectionPathResult[]
    sharedEdges: SharedEdgeSegment[]
  }) {
    super()
    this.srj = srj
    this.graph = inputGraph
    this.inputNodes = inputNodes
    this.connectionsWithResults = connectionsWithResults
    for (const sharedEdge of sharedEdges) {
      const [nodeId1, nodeId2] = sharedEdge.nodeIds
      const edgeKey = this.getEdgeKey(nodeId1, nodeId2)
      this.crammedPortPointsByEdgeKey.set(edgeKey, sharedEdge.crammedPortPoints)
      for (const pp of sharedEdge.crammedPortPoints) {
        this.crammedPortPointMap.set(pp.segmentPortPointId, pp)
      }
    }

    this.buildAdjacency()
    this.orderedObstacleIndices = this.srj.obstacles
      .map((obstacle, index) => ({
        index,
        x: obstacle.center.x,
        y: obstacle.center.y,
      }))
      .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
      .map((entry) => entry.index)

    this.MAX_ITERATIONS = Math.max(1, this.srj.obstacles.length * 128)
  }

  private getEdgeKey(
    nodeIdA: CapacityMeshNodeId,
    nodeIdB: CapacityMeshNodeId,
  ): string {
    return nodeIdA < nodeIdB
      ? `${nodeIdA}__${nodeIdB}`
      : `${nodeIdB}__${nodeIdA}`
  }

  private buildAdjacency() {
    for (const node of this.inputNodes) {
      this.adjacencyByNodeId.set(node.capacityMeshNodeId, new Set())
    }

    for (const port of this.graph.ports) {
      const nodeId1 = port.region1.regionId as CapacityMeshNodeId
      const nodeId2 = port.region2.regionId as CapacityMeshNodeId
      const edgeKey = this.getEdgeKey(nodeId1, nodeId2)
      const normalPortIds = this.normalPortIdsByEdgeKey.get(edgeKey) ?? []
      normalPortIds.push(port.portId)
      this.normalPortIdsByEdgeKey.set(edgeKey, normalPortIds)
      this.adjacencyByNodeId.get(nodeId1)?.add(nodeId2)
      this.adjacencyByNodeId.get(nodeId2)?.add(nodeId1)
    }

    // Include crammed-only candidate edges so retry BFS can traverse them.
    for (const edgeKey of this.crammedPortPointsByEdgeKey.keys()) {
      const [nodeId1, nodeId2] = edgeKey.split("__") as [
        CapacityMeshNodeId,
        CapacityMeshNodeId,
      ]
      this.adjacencyByNodeId.get(nodeId1)?.add(nodeId2)
      this.adjacencyByNodeId.get(nodeId2)?.add(nodeId1)
    }
  }

  private findClosestNodeId(
    point: { x: number; y: number },
    preferredNodes: InputNodeWithPortPoints[],
  ): CapacityMeshNodeId | null {
    const nodes = preferredNodes.length > 0 ? preferredNodes : this.inputNodes
    if (nodes.length === 0) return null

    let bestNode = nodes[0]
    let bestDist = distance(point, bestNode.center)

    for (let i = 1; i < nodes.length; i++) {
      const d = distance(point, nodes[i].center)
      if (d < bestDist) {
        bestDist = d
        bestNode = nodes[i]
      }
    }

    return bestNode.capacityMeshNodeId
  }

  private resetCurrentObstacleTraversalState() {
    this.currentDiscoveredDepthByNodeId = new Map()
    this.currentDiscoveredDepthByEdgeKey = new Map()
    this.discoveredPortIdsByDegree = new Map([
      [0, new Set()],
      [1, new Set()],
      [2, new Set()],
    ])
    this.currentChokeBlockedAtDegree2 = false
    this.frontier = []
    this.frontierCursor = 0
    this.nextFrontier = []
    this.activeExpandDegree = null
    this.currentUsedCrammedPortPointIds = new Set()
    this.activeObstacleUsesCrammed = false
    this.lastExpansion = null
  }

  private getPortIdsBetweenNodes(
    nodeIdA: CapacityMeshNodeId,
    nodeIdB: CapacityMeshNodeId,
    activeCrammedPortPointIds?: Set<string>,
  ): { portIds: string[]; includesCrammed: boolean } {
    const edgeKey = this.getEdgeKey(nodeIdA, nodeIdB)
    const normalPortIds = this.normalPortIdsByEdgeKey.get(edgeKey) ?? []
    const crammedPortIds =
      this.crammedPortPointsByEdgeKey
        .get(edgeKey)
        ?.filter((pp) => activeCrammedPortPointIds?.has(pp.segmentPortPointId))
        .map((pp) => pp.segmentPortPointId) ?? []
    return {
      portIds: [...normalPortIds, ...crammedPortIds],
      includesCrammed: crammedPortIds.length > 0,
    }
  }

  private expandOneDegreeIncremental(nextDegree: 1 | 2): boolean {
    if (this.activeExpandDegree !== nextDegree) {
      this.activeExpandDegree = nextDegree
      this.frontierCursor = 0
      this.nextFrontier = []
    }

    const frontierNodeId = this.frontier[this.frontierCursor]
    if (!frontierNodeId) {
      this.frontier = this.nextFrontier
      this.frontierCursor = 0
      this.nextFrontier = []
      this.activeExpandDegree = null
      return true
    }

    this.lastExpansion = null
    const neighbors = this.adjacencyByNodeId.get(frontierNodeId)
    if (neighbors) {
      for (const neighborId of neighbors) {
        if (this.currentDiscoveredDepthByNodeId.has(neighborId)) continue
        this.currentDiscoveredDepthByNodeId.set(neighborId, nextDegree)
        const edgeKey = this.getEdgeKey(frontierNodeId, neighborId)
        const prevDegree = this.currentDiscoveredDepthByEdgeKey.get(edgeKey)
        if (prevDegree === undefined || nextDegree < prevDegree) {
          this.currentDiscoveredDepthByEdgeKey.set(edgeKey, nextDegree)
        }
        const { portIds } = this.getPortIdsBetweenNodes(
          frontierNodeId,
          neighborId,
          this.currentUsedCrammedPortPointIds,
        )
        if (portIds.length === 0) continue
        for (const portId of portIds) {
          this.discoveredPortIdsByDegree.get(nextDegree)?.add(portId)
        }
        this.lastExpansion = {
          degree: nextDegree,
          fromNodeId: frontierNodeId,
          toNodeId: neighborId,
          usedCrammed: false,
        }
        this.nextFrontier.push(neighborId)
      }
    }

    this.frontierCursor += 1
    return false
  }

  private isPortTouchingObstacle(portId: string): boolean {
    const port = this.graph.ports.find((p) => p.portId === portId)
    let nodeId1: CapacityMeshNodeId | null = null
    let nodeId2: CapacityMeshNodeId | null = null
    if (port) {
      nodeId1 = port.region1.regionId as CapacityMeshNodeId
      nodeId2 = port.region2.regionId as CapacityMeshNodeId
    } else {
      const crammedPort = this.crammedPortPointMap.get(portId)
      if (!crammedPort) return false
      nodeId1 = crammedPort.nodeIds[0]
      nodeId2 = crammedPort.nodeIds[1]
    }
    const node1 = this.inputNodes.find((n) => n.capacityMeshNodeId === nodeId1)
    const node2 = this.inputNodes.find((n) => n.capacityMeshNodeId === nodeId2)
    return Boolean(node1?._containsObstacle || node2?._containsObstacle)
  }

  private computeChokeBlockedAtDegree(degree: 2): boolean {
    const portIds = this.discoveredPortIdsByDegree.get(degree)
    if (!portIds || portIds.size === 0) return false
    for (const portId of portIds) {
      if (!this.isPortTouchingObstacle(portId)) return false
    }
    return true
  }

  private runDepth2BfsWithSelectedCrammed({
    selectedCrammedPortPointIds,
  }: {
    selectedCrammedPortPointIds: Set<string>
  }): {
    discoveredDepthByNodeId: Map<CapacityMeshNodeId, number>
    discoveredDepthByEdgeKey: Map<string, number>
    discoveredPortIdsByDegree: Map<0 | 1 | 2, Set<string>>
    chokeBlockedAtDegree2: boolean
  } {
    const discoveredDepthByNodeId = new Map<CapacityMeshNodeId, number>()
    const discoveredDepthByEdgeKey = new Map<string, number>()
    const discoveredPortIdsByDegree: Map<0 | 1 | 2, Set<string>> = new Map([
      [0, new Set()],
      [1, new Set()],
      [2, new Set()],
    ])
    if (!this.currentAnchorNodeId) {
      return {
        discoveredDepthByNodeId,
        discoveredDepthByEdgeKey,
        discoveredPortIdsByDegree,
        chokeBlockedAtDegree2: false,
      }
    }

    discoveredDepthByNodeId.set(this.currentAnchorNodeId, 0)
    let frontier: CapacityMeshNodeId[] = [this.currentAnchorNodeId]

    for (const degree of [1, 2] as const) {
      const nextFrontier: CapacityMeshNodeId[] = []
      for (const nodeId of frontier) {
        const neighbors = this.adjacencyByNodeId.get(nodeId)
        if (!neighbors) continue
        for (const neighborId of neighbors) {
          if (discoveredDepthByNodeId.has(neighborId)) continue
          discoveredDepthByNodeId.set(neighborId, degree)
          const edgeKey = this.getEdgeKey(nodeId, neighborId)
          const prevDegree = discoveredDepthByEdgeKey.get(edgeKey)
          if (prevDegree === undefined || degree < prevDegree) {
            discoveredDepthByEdgeKey.set(edgeKey, degree)
          }
          const { portIds } = this.getPortIdsBetweenNodes(
            nodeId,
            neighborId,
            selectedCrammedPortPointIds,
          )
          if (portIds.length === 0) continue
          for (const portId of portIds) {
            discoveredPortIdsByDegree.get(degree)?.add(portId)
          }
          nextFrontier.push(neighborId)
        }
      }
      frontier = nextFrontier
    }

    const degree2Ports = discoveredPortIdsByDegree.get(2) ?? new Set()
    let chokeBlockedAtDegree2 = degree2Ports.size > 0
    for (const portId of degree2Ports) {
      if (!this.isPortTouchingObstacle(portId)) {
        chokeBlockedAtDegree2 = false
        break
      }
    }

    return {
      discoveredDepthByNodeId,
      discoveredDepthByEdgeKey,
      discoveredPortIdsByDegree,
      chokeBlockedAtDegree2,
    }
  }

  private tryResolveChokeWithCrammedPortsForCurrentObstacle(): boolean {
    const candidateCrammedPortPoints = new Map<
      string,
      SharedEdgeSegment["crammedPortPoints"][number]
    >()
    const degree1Nodes = new Set<CapacityMeshNodeId>()
    for (const [nodeId, depth] of this.currentDiscoveredDepthByNodeId) {
      if (depth === 1) {
        degree1Nodes.add(nodeId)
      }
    }

    for (const [edgeKey, crammedPortPoints] of this
      .crammedPortPointsByEdgeKey) {
      const [nodeIdA, nodeIdB] = edgeKey.split("__") as [
        CapacityMeshNodeId,
        CapacityMeshNodeId,
      ]
      if (!degree1Nodes.has(nodeIdA) && !degree1Nodes.has(nodeIdB)) continue
      for (const pp of crammedPortPoints) {
        candidateCrammedPortPoints.set(pp.segmentPortPointId, pp)
      }
    }

    if (candidateCrammedPortPoints.size === 0) {
      return false
    }

    const orderedCandidates = [...candidateCrammedPortPoints.values()].sort(
      (a, b) => {
        const aTouching = this.isPortTouchingObstacle(a.segmentPortPointId)
        const bTouching = this.isPortTouchingObstacle(b.segmentPortPointId)
        if (aTouching !== bTouching) return aTouching ? 1 : -1
        return (
          (a.distToCentermostPortOnZ ?? 0) - (b.distToCentermostPortOnZ ?? 0)
        )
      },
    )

    const selectedCrammedPortPointIds = new Set<string>()
    for (const candidate of orderedCandidates) {
      selectedCrammedPortPointIds.add(candidate.segmentPortPointId)
      const rerun = this.runDepth2BfsWithSelectedCrammed({
        selectedCrammedPortPointIds,
      })
      if (!rerun.chokeBlockedAtDegree2) {
        this.currentDiscoveredDepthByNodeId = rerun.discoveredDepthByNodeId
        this.currentDiscoveredDepthByEdgeKey = rerun.discoveredDepthByEdgeKey
        this.discoveredPortIdsByDegree = rerun.discoveredPortIdsByDegree
        this.currentChokeBlockedAtDegree2 = false
        this.currentUsedCrammedPortPointIds = new Set(
          selectedCrammedPortPointIds,
        )
        for (const portPointId of selectedCrammedPortPointIds) {
          this.usedCrammedPortPointIds.add(portPointId)
        }
        this.activeObstacleUsesCrammed = true
        return true
      }
    }
    return false
  }

  _step() {
    if (this.phase === "done") {
      this.solved = true
      return
    }

    if (this.currentObstacleIndex >= this.srj.obstacles.length) {
      this.phase = "done"
      this.solved = true
      return
    }

    if (this.phase === "select_obstacle") {
      this.currentObstacleSrjIndex =
        this.orderedObstacleIndices[this.currentObstacleIndex] ??
        this.currentObstacleIndex
      this.currentObstacle = this.srj.obstacles[this.currentObstacleSrjIndex]
      this.currentAnchorNodeId = this.findClosestNodeId(
        this.currentObstacle.center,
        this.inputNodes.filter((n) => n._containsObstacle),
      )
      this.resetCurrentObstacleTraversalState()
      this.phase = "associate_targets"
      return
    }

    if (this.phase === "associate_targets") {
      this.phase = "bfs_degree_0"
      return
    }

    if (this.phase === "bfs_degree_0") {
      if (this.currentAnchorNodeId) {
        this.currentDiscoveredDepthByNodeId.set(this.currentAnchorNodeId, 0)
        this.frontier = [this.currentAnchorNodeId]
      } else {
        this.frontier = []
      }
      this.frontierCursor = 0
      this.nextFrontier = []
      this.activeExpandDegree = null
      this.phase = "bfs_degree_1"
      return
    }

    if (this.phase === "bfs_degree_1") {
      const doneExpanding = this.expandOneDegreeIncremental(1)
      if (doneExpanding) {
        this.phase = "bfs_degree_2"
      }
      return
    }

    if (this.phase === "bfs_degree_2") {
      const doneExpanding = this.expandOneDegreeIncremental(2)
      if (!doneExpanding) {
        return
      }
      this.currentChokeBlockedAtDegree2 = this.computeChokeBlockedAtDegree(2)
      this.phase = this.currentChokeBlockedAtDegree2
        ? "retry_with_crammed"
        : "finalize_obstacle"
      return
    }

    if (this.phase === "retry_with_crammed") {
      const resolved = this.tryResolveChokeWithCrammedPortsForCurrentObstacle()
      if (!resolved) {
        this.error = `Obstacle ${this.currentObstacleSrjIndex ?? this.currentObstacleIndex} failed 2-hop reachability check: all degree-2 ports are blocked by obstacle-touching nodes`
        this.failed = true
        return
      }
      this.phase = "finalize_obstacle"
      return
    }

    if (this.phase === "finalize_obstacle") {
      this.results.push({
        obstacleIndex:
          this.currentObstacleSrjIndex ?? this.currentObstacleIndex,
        obstacle: this.currentObstacle!,
        anchorNodeId: this.currentAnchorNodeId,
        discoveredDepthByNodeId: new Map(this.currentDiscoveredDepthByNodeId),
        discoveredDepthByEdgeKey: new Map(this.currentDiscoveredDepthByEdgeKey),
        chokeBlockedAtDegree2: this.currentChokeBlockedAtDegree2,
        usedCrammedPortPointIds: new Set(this.currentUsedCrammedPortPointIds),
      })

      this.currentObstacleIndex++
      this.currentObstacle = null
      this.currentObstacleSrjIndex = null
      this.currentAnchorNodeId = null
      this.resetCurrentObstacleTraversalState()
      this.phase =
        this.currentObstacleIndex >= this.srj.obstacles.length
          ? "done"
          : "select_obstacle"
    }
  }

  computeProgress(): number {
    if (this.srj.obstacles.length === 0) return 1
    const perObstacleStages = 7
    const stageIndex =
      this.phase === "select_obstacle"
        ? 0
        : this.phase === "associate_targets"
          ? 1
          : this.phase === "bfs_degree_0"
            ? 2
            : this.phase === "bfs_degree_1"
              ? 3
              : this.phase === "bfs_degree_2"
                ? 4
                : this.phase === "retry_with_crammed"
                  ? 5
                  : this.phase === "finalize_obstacle"
                    ? 6
                    : 7
    const doneUnits = this.currentObstacleIndex * perObstacleStages + stageIndex
    const totalUnits = this.srj.obstacles.length * perObstacleStages
    return Math.min(1, doneUnits / Math.max(1, totalUnits))
  }

  private getVisualState(): ObstacleResult | null {
    if (this.phase === "done") {
      return this.results[this.results.length - 1] ?? null
    }

    if (this.currentObstacle === null) return null
    return {
      obstacleIndex: this.currentObstacleSrjIndex ?? this.currentObstacleIndex,
      obstacle: this.currentObstacle,
      anchorNodeId: this.currentAnchorNodeId,
      discoveredDepthByNodeId: this.currentDiscoveredDepthByNodeId,
      discoveredDepthByEdgeKey: this.currentDiscoveredDepthByEdgeKey,
      chokeBlockedAtDegree2: this.currentChokeBlockedAtDegree2,
      usedCrammedPortPointIds: this.currentUsedCrammedPortPointIds,
    }
  }

  visualize(): GraphicsObject {
    const lines: Line[] = []
    const points: Point[] = []
    const rects: Rect[] = []
    const state = this.getVisualState()

    for (let i = 0; i < this.srj.obstacles.length; i++) {
      const obstacle = this.srj.obstacles[i]
      const isActive = state?.obstacleIndex === i
      rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: isActive ? "rgba(255, 180, 0, 0.20)" : "rgba(255, 0, 0, 0.08)",
        stroke: isActive ? "rgba(255, 140, 0, 0.95)" : "rgba(255, 0, 0, 0.2)",
        label: `obstacle ${i}${isActive ? " (active)" : ""}`,
      })
    }

    if (state) {
      for (const degree of [0, 1, 2] as const) {
        const discoveredPortIds = this.discoveredPortIdsByDegree.get(degree)
        if (!discoveredPortIds) continue

        const color =
          degree === 0
            ? DEGREE_0_COLOR
            : degree === 1
              ? DEGREE_1_COLOR
              : DEGREE_2_COLOR

        for (const portId of discoveredPortIds) {
          const graphPort = this.graph.ports.find((p) => p.portId === portId)
          const graphPortPoint = graphPort
            ? ((graphPort as any).d as any)
            : null
          const crammedPortPoint = this.crammedPortPointMap.get(portId)
          const x = graphPortPoint?.x ?? crammedPortPoint?.x
          const y = graphPortPoint?.y ?? crammedPortPoint?.y
          if (typeof x !== "number" || typeof y !== "number") {
            continue
          }

          if (crammedPortPoint) {
            rects.push({
              center: { x, y },
              width: 0.18,
              height: 0.18,
              fill: color,
              stroke: "rgba(0,0,0,0.35)",
              label: [
                `crammed ${portId}`,
                `degree ${degree}`,
                state.usedCrammedPortPointIds.has(portId)
                  ? "used"
                  : "candidate",
              ].join("\n"),
            })
          } else {
            points.push({
              x,
              y,
              color,
              label: `hyperedge ${portId}\ndegree ${degree}`,
            })
          }
        }
      }

      const activeRect = rects.find((r) => r.label?.includes("(active)"))
      if (activeRect) {
        activeRect.label = [
          activeRect.label,
          `chokeBlocked@2: ${state.chokeBlockedAtDegree2 ? "yes" : "no"}`,
          `usingCrammed: ${this.activeObstacleUsesCrammed ? "yes" : "no"}`,
          `frontier: ${this.frontier.length} (cursor ${this.frontierCursor})`,
          this.lastExpansion
            ? `last: d${this.lastExpansion.degree} ${this.lastExpansion.fromNodeId}->${this.lastExpansion.toNodeId}`
            : "last: none",
        ].join("\n")
      }
    }

    rects.push(
      {
        center: {
          x: this.srj.bounds.minX + 0.7,
          y: this.srj.bounds.minY + 0.7,
        },
        width: 0.5,
        height: 0.5,
        fill: DEGREE_0_COLOR,
        label: "Degree 0 hyperedge",
      },
      {
        center: {
          x: this.srj.bounds.minX + 0.7,
          y: this.srj.bounds.minY + 1.4,
        },
        width: 0.5,
        height: 0.5,
        fill: DEGREE_1_COLOR,
        label: "Degree 1 hyperedge",
      },
      {
        center: {
          x: this.srj.bounds.minX + 0.7,
          y: this.srj.bounds.minY + 2.1,
        },
        width: 0.5,
        height: 0.5,
        fill: DEGREE_2_COLOR,
        label: "Degree 2 hyperedge",
      },
      {
        center: {
          x: this.srj.bounds.minX + 1.8,
          y: this.srj.bounds.minY + 1.9,
        },
        width: 2.0,
        height: 3.0,
        fill: "rgba(255,255,255,0.03)",
        stroke: "rgba(255,255,255,0.2)",
        label: [
          `phase: ${this.phase}`,
          `obstacle: ${Math.min(this.currentObstacleIndex, this.srj.obstacles.length)}/${this.srj.obstacles.length}`,
          `used crammed total: ${this.usedCrammedPortPointIds.size}`,
        ].join("\n"),
      },
    )

    return {
      lines,
      rects,
      points,
    }
  }
}
