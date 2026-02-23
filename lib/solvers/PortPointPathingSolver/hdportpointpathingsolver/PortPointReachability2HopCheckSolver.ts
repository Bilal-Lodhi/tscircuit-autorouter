import type { HyperGraph } from "@tscircuit/hypergraph"
import { distance } from "@tscircuit/math-utils"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
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
  | "finalize_obstacle"
  | "done"

interface ObstacleResult {
  obstacleIndex: number
  obstacle: Obstacle
  anchorNodeId: CapacityMeshNodeId | null
  discoveredDepthByNodeId: Map<CapacityMeshNodeId, number>
  discoveredDepthByEdgeKey: Map<string, number>
  chokeBlockedAtDegree2: boolean
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
  results: ObstacleResult[] = []

  currentObstacle: Obstacle | null = null
  currentAnchorNodeId: CapacityMeshNodeId | null = null
  currentDiscoveredDepthByNodeId: Map<CapacityMeshNodeId, number> = new Map()
  currentDiscoveredDepthByEdgeKey: Map<string, number> = new Map()
  discoveredPortIdsByDegree: Map<2, Set<string>> = new Map([
    [2, new Set()],
  ])
  currentChokeBlockedAtDegree2 = false
  frontier: CapacityMeshNodeId[] = []

  adjacencyByNodeId = new Map<CapacityMeshNodeId, Set<CapacityMeshNodeId>>()

  constructor({
    srj,
    inputGraph,
    inputNodes,
    connectionsWithResults,
  }: {
    srj: SimpleRouteJson
    inputGraph: HyperGraph
    inputNodes: InputNodeWithPortPoints[]
    connectionsWithResults: ConnectionPathResult[]
  }) {
    super()
    this.srj = srj
    this.graph = inputGraph
    this.inputNodes = inputNodes
    this.connectionsWithResults = connectionsWithResults

    this.buildAdjacency()

    this.MAX_ITERATIONS = Math.max(1, this.srj.obstacles.length * 8)
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

  private expandOneDegree(nextDegree: 1 | 2) {
    const nextFrontier: CapacityMeshNodeId[] = []

    for (const nodeId of this.frontier) {
      const neighbors = this.adjacencyByNodeId.get(nodeId)
      if (!neighbors) continue

      for (const neighborId of neighbors) {
        if (this.currentDiscoveredDepthByNodeId.has(neighborId)) continue
        this.currentDiscoveredDepthByNodeId.set(neighborId, nextDegree)
        const edgeKey = this.getEdgeKey(nodeId, neighborId)
        const prevDegree = this.currentDiscoveredDepthByEdgeKey.get(edgeKey)
        if (prevDegree === undefined || nextDegree < prevDegree) {
          this.currentDiscoveredDepthByEdgeKey.set(edgeKey, nextDegree)
        }
        const portIds = this.getPortIdsBetweenNodes(nodeId, neighborId)
        if (nextDegree === 2) {
          for (const portId of portIds) {
            this.discoveredPortIdsByDegree.get(2)?.add(portId)
          }
        }
        nextFrontier.push(neighborId)
      }
    }

    this.frontier = nextFrontier
  }

  private getPortIdsBetweenNodes(
    nodeIdA: CapacityMeshNodeId,
    nodeIdB: CapacityMeshNodeId,
  ): string[] {
    const ids: string[] = []
    for (const port of this.graph.ports) {
      const r1 = port.region1.regionId as CapacityMeshNodeId
      const r2 = port.region2.regionId as CapacityMeshNodeId
      if (
        (r1 === nodeIdA && r2 === nodeIdB) ||
        (r1 === nodeIdB && r2 === nodeIdA)
      ) {
        ids.push(port.portId)
      }
    }
    return ids
  }

  private isPortTouchingObstacle(portId: string): boolean {
    const port = this.graph.ports.find((p) => p.portId === portId)
    if (!port) return false
    const nodeId1 = port.region1.regionId as CapacityMeshNodeId
    const nodeId2 = port.region2.regionId as CapacityMeshNodeId
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
      this.currentObstacle = this.srj.obstacles[this.currentObstacleIndex]
      this.currentAnchorNodeId = this.findClosestNodeId(
        this.currentObstacle.center,
        this.inputNodes.filter((n) => n._containsObstacle),
      )
      this.currentDiscoveredDepthByNodeId = new Map()
      this.currentDiscoveredDepthByEdgeKey = new Map()
      this.discoveredPortIdsByDegree = new Map([[2, new Set()]])
      this.currentChokeBlockedAtDegree2 = false
      this.frontier = []
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
      this.phase = "bfs_degree_1"
      return
    }

    if (this.phase === "bfs_degree_1") {
      this.expandOneDegree(1)
      this.phase = "bfs_degree_2"
      return
    }

    if (this.phase === "bfs_degree_2") {
      this.expandOneDegree(2)
      this.currentChokeBlockedAtDegree2 = this.computeChokeBlockedAtDegree(2)
      if (this.currentChokeBlockedAtDegree2) {
        this.error = `Obstacle ${this.currentObstacleIndex} failed 2-hop reachability check: all degree-2 ports are blocked by obstacle-touching nodes`
        this.failed = true
        return
      }
      this.phase = "finalize_obstacle"
      return
    }

    if (this.phase === "finalize_obstacle") {
      this.results.push({
        obstacleIndex: this.currentObstacleIndex,
        obstacle: this.currentObstacle!,
        anchorNodeId: this.currentAnchorNodeId,
        discoveredDepthByNodeId: new Map(this.currentDiscoveredDepthByNodeId),
        discoveredDepthByEdgeKey: new Map(this.currentDiscoveredDepthByEdgeKey),
        chokeBlockedAtDegree2: this.currentChokeBlockedAtDegree2,
      })

      this.currentObstacleIndex++
      this.currentObstacle = null
      this.currentAnchorNodeId = null
      this.currentDiscoveredDepthByNodeId = new Map()
      this.currentDiscoveredDepthByEdgeKey = new Map()
      this.discoveredPortIdsByDegree = new Map([[2, new Set()]])
      this.currentChokeBlockedAtDegree2 = false
      this.frontier = []
      this.phase =
        this.currentObstacleIndex >= this.srj.obstacles.length
          ? "done"
          : "select_obstacle"
    }
  }

  computeProgress(): number {
    if (this.srj.obstacles.length === 0) return 1
    const perObstacleStages = 6
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
                : this.phase === "finalize_obstacle"
                  ? 5
                  : 6
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
      obstacleIndex: this.currentObstacleIndex,
      obstacle: this.currentObstacle,
      anchorNodeId: this.currentAnchorNodeId,
      discoveredDepthByNodeId: this.currentDiscoveredDepthByNodeId,
      discoveredDepthByEdgeKey: this.currentDiscoveredDepthByEdgeKey,
      chokeBlockedAtDegree2: this.currentChokeBlockedAtDegree2,
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
      for (const port of this.graph.ports) {
        const nodeId1 = port.region1.regionId as CapacityMeshNodeId
        const nodeId2 = port.region2.regionId as CapacityMeshNodeId
        const edgeKey = this.getEdgeKey(nodeId1, nodeId2)
        const degree = state.discoveredDepthByEdgeKey.get(edgeKey)
        const d = (port as any).d
        if (
          degree === undefined ||
          degree > 2 ||
          typeof d?.x !== "number" ||
          typeof d?.y !== "number"
        ) {
          continue
        }
        const color =
          degree === 0
            ? DEGREE_0_COLOR
            : degree === 1
              ? DEGREE_1_COLOR
              : DEGREE_2_COLOR
        points.push({
          x: d.x,
          y: d.y,
          color,
          label: `hyperedge ${port.portId}\ndegree ${degree}`,
        })
      }

      const activeRect = rects.find((r) => r.label?.includes("(active)"))
      if (activeRect) {
        activeRect.label = [
          activeRect.label,
          `chokeBlocked@2: ${state.chokeBlockedAtDegree2 ? "yes" : "no"}`,
        ].join("\n")
      }
    }

    rects.push(
      {
        center: { x: this.srj.bounds.minX + 0.7, y: this.srj.bounds.minY + 0.7 },
        width: 0.5,
        height: 0.5,
        fill: DEGREE_0_COLOR,
        label: "Degree 0 hyperedge",
      },
      {
        center: { x: this.srj.bounds.minX + 0.7, y: this.srj.bounds.minY + 1.4 },
        width: 0.5,
        height: 0.5,
        fill: DEGREE_1_COLOR,
        label: "Degree 1 hyperedge",
      },
      {
        center: { x: this.srj.bounds.minX + 0.7, y: this.srj.bounds.minY + 2.1 },
        width: 0.5,
        height: 0.5,
        fill: DEGREE_2_COLOR,
        label: "Degree 2 hyperedge",
      },
      {
        center: { x: this.srj.bounds.minX + 1.8, y: this.srj.bounds.minY + 1.9 },
        width: 2.0,
        height: 2.4,
        fill: "rgba(255,255,255,0.03)",
        stroke: "rgba(255,255,255,0.2)",
        label: [
          `phase: ${this.phase}`,
          `obstacle: ${Math.min(this.currentObstacleIndex, this.srj.obstacles.length)}/${this.srj.obstacles.length}`,
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
