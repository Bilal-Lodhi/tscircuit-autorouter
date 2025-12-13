import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
  ConnectionPathResult,
  PortPointPathingHyperParameters,
} from "../PortPointPathingSolver/PortPointPathingSolver"
import { PortPointPathingSolver } from "../PortPointPathingSolver/PortPointPathingSolver"
import {
  createPortPointSection,
  type CreatePortPointSectionInput,
  type PortPointSection,
  type PortPointSectionParams,
} from "./createPortPointSection"
import type {
  PortPoint,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { computeSectionScore, computeNodePf } from "./computeSectionScore"
import { visualizeSection } from "./visualizeSection"

export interface MultiSectionPortPointOptimizerParams {
  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  colorMap?: Record<string, string>
  /** Results from the initial PortPointPathingSolver run */
  initialConnectionResults: ConnectionPathResult[]
  /** Assigned port points from initial run */
  initialAssignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  /** Node assigned port points from initial run */
  initialNodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
}

const OPTIMIZATION_SCHEDULE: (PortPointPathingHyperParameters & {
  EXPANSION_DEGREES: number
})[] = [
  {
    SHUFFLE_SEED: 0,
    CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
    EXPANSION_DEGREES: 3,
    GREEDY_MULTIPLIER: 3,
  },
  // {
  //   SHUFFLE_SEED: 1,
  //   CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
  //   EXPANSION_DEGREES: 6,
  //   GREEDY_MULTIPLIER: 3,
  // },
  // {
  //   SHUFFLE_SEED: 2,
  //   CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
  //   EXPANSION_DEGREES: 7,
  //   GREEDY_MULTIPLIER: 3,
  // },
]

/**
 * MultiSectionPortPointOptimizer runs local optimization on sections of the
 * port point graph. It takes the output of PortPointPathingSolver and attempts
 * to improve routing by re-running the solver on localized sections.
 *
 * This phase runs after portPointPathingSolver to refine routes in problematic areas.
 */
export class MultiSectionPortPointOptimizer extends BaseSolver {
  simpleRouteJson: SimpleRouteJson
  inputNodes: InputNodeWithPortPoints[]
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  colorMap: Record<string, string>

  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
  capacityMeshNodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>

  /** Current connection results (updated as sections are optimized) */
  connectionResults: ConnectionPathResult[]
  /** Current assigned port points */
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  /** Current node assigned port points */
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>

  /** Sections that have been created for optimization */
  sections: PortPointSection[] = []

  /** Section solver currently running */
  activeSubSolver: PortPointPathingSolver | null = null

  /** Current section being optimized */
  currentSection: PortPointSection | null = null

  /** Score before optimization (for comparison) */
  sectionScoreBeforeOptimization: number = 0

  /** Node ID of the center of the current section */
  currentSectionCenterNodeId: CapacityMeshNodeId | null = null

  /** Current index in the optimization schedule */
  currentScheduleIndex: number = 0

  /** Probability of failure for each node */
  nodePfMap: Map<CapacityMeshNodeId, number> = new Map()

  /** Number of attempts to fix each node */
  attemptsToFixNode: Map<CapacityMeshNodeId, number> = new Map()

  /** Total number of section optimization attempts made */
  sectionAttempts: number = 0

  /** Maximum number of attempts per node */
  MAX_NODE_ATTEMPTS = OPTIMIZATION_SCHEDULE.length

  /** Maximum total number of section optimization attempts */
  MAX_SECTION_ATTEMPTS = 1000

  /** Acceptable probability of failure threshold */
  ACCEPTABLE_PF = 0.01

  constructor(params: MultiSectionPortPointOptimizerParams) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.simpleRouteJson = params.simpleRouteJson
    this.inputNodes = params.inputNodes
    this.capacityMeshNodes = params.capacityMeshNodes
    this.capacityMeshEdges = params.capacityMeshEdges
    this.colorMap = params.colorMap ?? {}

    this.nodeMap = new Map(
      params.inputNodes.map((n) => [n.capacityMeshNodeId, n]),
    )
    this.capacityMeshNodeMap = new Map(
      params.capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
    )

    // Copy initial results
    this.connectionResults = [...params.initialConnectionResults]
    this.assignedPortPoints = new Map(params.initialAssignedPortPoints)
    this.nodeAssignedPortPoints = new Map(params.initialNodeAssignedPortPoints)

    // Initialize Pf map
    this.nodePfMap = this.computeInitialPfMap()

    // Compute initial board score
    const initialBoardScore = this.computeBoardScore()

    // Initialize stats
    this.stats.successfulOptimizations = 0
    this.stats.failedOptimizations = 0
    this.stats.nodesExamined = 0
    this.stats.sectionAttempts = 0
    this.stats.sectionScores = {} as Record<string, number>
    this.stats.initialBoardScore = initialBoardScore
    this.stats.currentBoardScore = initialBoardScore
  }

  /**
   * Compute initial Pf map for all nodes
   */
  computeInitialPfMap(): Map<CapacityMeshNodeId, number> {
    const pfMap = new Map<CapacityMeshNodeId, number>()

    for (const node of this.capacityMeshNodes) {
      const portPoints =
        this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
      if (portPoints.length === 0) continue

      const nodeWithPortPoints: NodeWithPortPoints = {
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints,
        availableZ: node.availableZ,
      }

      const pf = computeNodePf(nodeWithPortPoints, node)
      pfMap.set(node.capacityMeshNodeId, pf)
    }

    return pfMap
  }

  /**
   * Compute the score for the ENTIRE board (all nodes with port points).
   * Lower scores are better.
   */
  computeBoardScore(): number {
    const allNodesWithPortPoints = this.getNodesWithPortPoints()
    return computeSectionScore(allNodesWithPortPoints, this.capacityMeshNodeMap)
  }

  /**
   * Recompute Pf for nodes in a section
   */
  recomputePfForNodes(nodeIds: Set<CapacityMeshNodeId>) {
    for (const nodeId of nodeIds) {
      const node = this.capacityMeshNodeMap.get(nodeId)
      if (!node) continue

      const portPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
      if (portPoints.length === 0) {
        this.nodePfMap.set(nodeId, 0)
        continue
      }

      const nodeWithPortPoints: NodeWithPortPoints = {
        capacityMeshNodeId: nodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints,
        availableZ: node.availableZ,
      }

      const pf = computeNodePf(nodeWithPortPoints, node)
      this.nodePfMap.set(nodeId, pf)
    }
  }

  /**
   * Create input for createPortPointSection from current state
   */
  getCreatePortPointSectionInput(): CreatePortPointSectionInput {
    return {
      inputNodes: this.inputNodes,
      capacityMeshNodes: this.capacityMeshNodes,
      capacityMeshEdges: this.capacityMeshEdges,
      nodeMap: this.nodeMap,
      connectionResults: this.connectionResults,
    }
  }

  /**
   * Create a section for optimization
   */
  createSection(params: PortPointSectionParams): PortPointSection {
    const input = this.getCreatePortPointSectionInput()
    return createPortPointSection(input, params)
  }

  /**
   * Get nodes with port points for a section (for scoring)
   */
  getSectionNodesWithPortPoints(
    section: PortPointSection,
  ): NodeWithPortPoints[] {
    const result: NodeWithPortPoints[] = []

    for (const nodeId of section.nodeIds) {
      const inputNode = this.nodeMap.get(nodeId)
      const capacityNode = this.capacityMeshNodeMap.get(nodeId)
      if (!inputNode || !capacityNode) continue

      const portPoints = this.nodeAssignedPortPoints.get(nodeId) ?? []
      if (portPoints.length > 0) {
        result.push({
          capacityMeshNodeId: nodeId,
          center: inputNode.center,
          width: inputNode.width,
          height: inputNode.height,
          portPoints,
          availableZ: inputNode.availableZ,
        })
      }
    }

    return result
  }

  /**
   * Get nodes with port points for the section (for HighDensitySolver)
   */
  getNodesWithPortPoints(): NodeWithPortPoints[] {
    const result: NodeWithPortPoints[] = []

    for (const node of this.inputNodes) {
      const assignedPortPoints =
        this.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []

      if (assignedPortPoints.length > 0) {
        result.push({
          capacityMeshNodeId: node.capacityMeshNodeId,
          center: node.center,
          width: node.width,
          height: node.height,
          portPoints: assignedPortPoints,
          availableZ: node.availableZ,
        })
      }
    }

    return result
  }

  /**
   * Find the node with the highest probability of failure
   */
  findHighestPfNode(): CapacityMeshNodeId | null {
    let highestPfNodeId: CapacityMeshNodeId | null = null
    let highestPf = 0

    for (const [nodeId, pf] of this.nodePfMap.entries()) {
      // Reduce effective Pf based on number of attempts
      const attempts = this.attemptsToFixNode.get(nodeId) ?? 0
      const pfReduced = pf * (1 - attempts / this.MAX_NODE_ATTEMPTS)

      if (pfReduced > highestPf) {
        highestPf = pf
        highestPfNodeId = nodeId
      }
    }

    if (!highestPfNodeId || highestPf < this.ACCEPTABLE_PF) {
      return null
    }

    return highestPfNodeId
  }

  /**
   * Create a SimpleRouteJson for just the section's connections.
   * IMPORTANT: Only includes connections where BOTH start and end target nodes
   * are within the section. This ensures PortPointPathingSolver can route them correctly.
   */
  createSectionSimpleRouteJson(section: PortPointSection): SimpleRouteJson {
    // Find connections that are FULLY contained in the section
    // (both start and end target nodes must be in the section)
    const fullyContainedConnections: typeof this.simpleRouteJson.connections =
      []

    for (const result of this.connectionResults) {
      if (!result.path || result.path.length === 0) continue

      const [startNodeId, endNodeId] = result.nodeIds

      // Check if both start and end nodes are in the section
      const startInSection = section.nodeIds.has(startNodeId)
      const endInSection = section.nodeIds.has(endNodeId)

      if (startInSection && endInSection) {
        fullyContainedConnections.push(result.connection)
      }
    }

    return {
      ...this.simpleRouteJson,
      connections: fullyContainedConnections,
    }
  }

  getHyperParametersForAttempt(
    attempt: number,
  ): PortPointPathingHyperParameters {
    return {
      ...OPTIMIZATION_SCHEDULE[attempt % OPTIMIZATION_SCHEDULE.length],
      SHUFFLE_SEED:
        OPTIMIZATION_SCHEDULE[attempt % OPTIMIZATION_SCHEDULE.length]
          .SHUFFLE_SEED +
        attempt * 1700,
    }
  }

  /**
   * Reattach the optimized section results back to the main state.
   * Only called for connections that are FULLY contained in the section.
   */
  reattachSection(
    _section: PortPointSection,
    newConnectionResults: ConnectionPathResult[],
    newAssignedPortPoints: Map<
      string,
      { connectionName: string; rootConnectionName?: string }
    >,
    newNodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>,
  ) {
    // Get the connection names that were re-routed in this section
    const reRoutedConnectionNames = new Set(
      newConnectionResults.map((r) => r.connection.name),
    )

    // Remove old results for these connections
    this.connectionResults = this.connectionResults.filter(
      (r) => !reRoutedConnectionNames.has(r.connection.name),
    )

    // Add new results
    this.connectionResults.push(...newConnectionResults)

    // Clear ALL port points for re-routed connections from ALL nodes
    // (since we're replacing entire connections that are fully contained in the section)
    for (const [nodeId, portPoints] of this.nodeAssignedPortPoints.entries()) {
      const remainingPortPoints = portPoints.filter(
        (pp) => !reRoutedConnectionNames.has(pp.connectionName),
      )
      this.nodeAssignedPortPoints.set(nodeId, remainingPortPoints)
    }

    // Remove old assigned port points for re-routed connections
    for (const [portPointId, info] of this.assignedPortPoints.entries()) {
      if (reRoutedConnectionNames.has(info.connectionName)) {
        this.assignedPortPoints.delete(portPointId)
      }
    }

    // Add new assigned port points
    for (const [portPointId, info] of newAssignedPortPoints.entries()) {
      this.assignedPortPoints.set(portPointId, info)
    }

    // Add new node assigned port points
    for (const [nodeId, portPoints] of newNodeAssignedPortPoints.entries()) {
      const existing = this.nodeAssignedPortPoints.get(nodeId) ?? []
      this.nodeAssignedPortPoints.set(nodeId, [...existing, ...portPoints])
    }
  }

  _step() {
    if (this.activeSubSolver) {
      // Step the active sub-solver
      this.activeSubSolver.step()

      if (this.activeSubSolver.solved || this.activeSubSolver.failed) {
        if (this.activeSubSolver.failed) {
          // Sub-solver failed, try next schedule params or move on
          this.currentScheduleIndex++

          if (
            this.currentScheduleIndex < OPTIMIZATION_SCHEDULE.length &&
            this.currentSectionCenterNodeId
          ) {
            // Try next schedule params
            const params = OPTIMIZATION_SCHEDULE[this.currentScheduleIndex]
            this.currentSection = this.createSection({
              centerOfSectionCapacityNodeId: this.currentSectionCenterNodeId,
              expansionDegrees: params.EXPANSION_DEGREES,
            })

            const sectionSrj = this.createSectionSimpleRouteJson(
              this.currentSection,
            )

            this.activeSubSolver = new PortPointPathingSolver({
              simpleRouteJson: sectionSrj,
              inputNodes: this.currentSection.inputNodes,
              capacityMeshNodes: this.currentSection.capacityMeshNodes,
              colorMap: this.colorMap,
              hyperParameters: this.getHyperParametersForAttempt(
                this.sectionAttempts,
              ),
            })
          } else {
            // All schedule params exhausted, move on
            this.stats.failedOptimizations++
            this.activeSubSolver = null
            this.currentSection = null
            this.currentSectionCenterNodeId = null
            this.currentScheduleIndex = 0
          }
          return
        }

        // Sub-solver succeeded - compute new section score (for quick comparison)
        const newNodesWithPortPoints =
          this.activeSubSolver.getNodesWithPortPoints()
        const newSectionScore = computeSectionScore(
          newNodesWithPortPoints,
          this.capacityMeshNodeMap,
        )

        const attemptKey = `attempt${this.sectionAttempts}`

        // Compare section scores first (higher is better)
        if (newSectionScore > this.sectionScoreBeforeOptimization) {
          // Section score improved - tentatively apply and check board score
          const previousBoardScore = this.stats.currentBoardScore as number

          // Save state before applying changes (for potential revert)
          const savedConnectionResults = [...this.connectionResults]
          const savedAssignedPortPoints = new Map(this.assignedPortPoints)
          const savedNodeAssignedPortPoints = new Map(
            Array.from(this.nodeAssignedPortPoints.entries()).map(
              ([k, v]) => [k, [...v]] as [string, PortPoint[]],
            ),
          )

          // Apply the section changes
          this.reattachSection(
            this.currentSection!,
            this.activeSubSolver.connectionsWithResults,
            this.activeSubSolver.assignedPortPoints,
            this.activeSubSolver.nodeAssignedPortPoints,
          )

          // Recompute Pf for affected nodes
          this.recomputePfForNodes(this.currentSection!.nodeIds)

          // Compute the new board score AFTER applying the section
          const newBoardScore = this.computeBoardScore()

          // Record the board score after this attempt
          ;(this.stats.sectionScores as Record<string, number>)[attemptKey] =
            newBoardScore

          // Only count as successful if the BOARD score actually improved (higher is better)
          if (newBoardScore > previousBoardScore) {
            this.stats.successfulOptimizations++
            this.stats.currentBoardScore = newBoardScore
          } else {
            // Board score didn't improve - revert the changes
            this.connectionResults = savedConnectionResults
            this.assignedPortPoints = savedAssignedPortPoints
            this.nodeAssignedPortPoints = savedNodeAssignedPortPoints
            this.recomputePfForNodes(this.currentSection!.nodeIds)
            this.stats.failedOptimizations++
          }

          // Reset and move on
          this.activeSubSolver = null
          this.currentSection = null
          this.currentSectionCenterNodeId = null
          this.currentScheduleIndex = 0
        } else {
          // No improvement, try next schedule params
          this.currentScheduleIndex++

          if (
            this.currentScheduleIndex < OPTIMIZATION_SCHEDULE.length &&
            this.currentSectionCenterNodeId
          ) {
            // Try next schedule params
            const params = OPTIMIZATION_SCHEDULE[this.currentScheduleIndex]
            this.currentSection = this.createSection({
              centerOfSectionCapacityNodeId: this.currentSectionCenterNodeId,
              expansionDegrees: params.EXPANSION_DEGREES,
            })

            const sectionSrj = this.createSectionSimpleRouteJson(
              this.currentSection,
            )

            this.activeSubSolver = new PortPointPathingSolver({
              simpleRouteJson: sectionSrj,
              inputNodes: this.currentSection.inputNodes,
              capacityMeshNodes: this.currentSection.capacityMeshNodes,
              colorMap: this.colorMap,
              hyperParameters: this.getHyperParametersForAttempt(
                this.sectionAttempts,
              ),
            })
          } else {
            // All schedule params exhausted without improvement
            this.stats.failedOptimizations++
            this.activeSubSolver = null
            this.currentSection = null
            this.currentSectionCenterNodeId = null
            this.currentScheduleIndex = 0
          }
        }
      }
      return
    }

    // No active sub-solver - find highest Pf node and start new optimization

    // Check if we've exceeded the maximum number of section attempts
    if (this.sectionAttempts >= this.MAX_SECTION_ATTEMPTS) {
      this.solved = true
      return
    }

    const highestPfNodeId = this.findHighestPfNode()

    if (!highestPfNodeId) {
      // No nodes need optimization
      this.solved = true
      return
    }

    this.sectionAttempts++
    this.stats.sectionAttempts = this.sectionAttempts
    this.stats.nodesExamined++

    // Increment attempt counter
    this.attemptsToFixNode.set(
      highestPfNodeId,
      (this.attemptsToFixNode.get(highestPfNodeId) ?? 0) + 1,
    )

    // Create section centered on highest Pf node
    this.currentSectionCenterNodeId = highestPfNodeId
    this.currentScheduleIndex = 0
    const params = OPTIMIZATION_SCHEDULE[this.currentScheduleIndex]

    this.currentSection = this.createSection({
      centerOfSectionCapacityNodeId: highestPfNodeId,
      expansionDegrees: params.EXPANSION_DEGREES,
    })

    // Compute score before optimization
    const sectionNodesWithPortPoints = this.getSectionNodesWithPortPoints(
      this.currentSection,
    )
    this.sectionScoreBeforeOptimization = computeSectionScore(
      sectionNodesWithPortPoints,
      this.capacityMeshNodeMap,
    )

    // Create SimpleRouteJson for section
    const sectionSrj = this.createSectionSimpleRouteJson(this.currentSection)

    // Skip if no connections to optimize
    if (sectionSrj.connections.length === 0) {
      this.currentSection = null
      this.currentSectionCenterNodeId = null
      return
    }

    // Create and start PortPointPathingSolver for this section
    this.activeSubSolver = new PortPointPathingSolver({
      simpleRouteJson: sectionSrj,
      inputNodes: this.currentSection.inputNodes,
      capacityMeshNodes: this.currentSection.capacityMeshNodes,
      colorMap: this.colorMap,
      hyperParameters: this.getHyperParametersForAttempt(this.sectionAttempts),
    })
  }

  visualize(): GraphicsObject {
    // If we have an active sub-solver, delegate to it
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    // If we have a current section, visualize it
    if (this.currentSection) {
      return visualizeSection(this.currentSection, this.colorMap)
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw all nodes with Pf coloring
    for (const node of this.inputNodes) {
      const pf = this.nodePfMap.get(node.capacityMeshNodeId) ?? 0

      // Color based on Pf - red for high, green for low
      const red = Math.floor(255 * Math.min(pf, 1))
      const green = Math.floor(255 * (1 - Math.min(pf, 1)))
      const color = `rgba(${red}, ${green}, 0, 0.3)`

      graphics.rects!.push({
        center: node.center,
        width: node.width * 0.9,
        height: node.height * 0.9,
        fill: color,
        label: `${node.capacityMeshNodeId}\nPf: ${pf.toFixed(3)}`,
      })
    }

    // Draw solved paths from connection results
    for (const result of this.connectionResults) {
      if (!result.path) continue

      const connection = result.connection
      const color = this.colorMap[connection.name] ?? "blue"

      const segmentPoints: Array<{ x: number; y: number; z: number }> = []
      for (const candidate of result.path) {
        segmentPoints.push({
          x: candidate.point.x,
          y: candidate.point.y,
          z: candidate.z,
        })
      }

      for (let i = 0; i < segmentPoints.length - 1; i++) {
        const pointA = segmentPoints[i]
        const pointB = segmentPoints[i + 1]

        const sameLayer = pointA.z === pointB.z
        const commonLayer = pointA.z

        let strokeDash: string | undefined
        if (sameLayer) {
          strokeDash = commonLayer === 0 ? undefined : "10 5"
        } else {
          strokeDash = "3 3 10"
        }

        graphics.lines!.push({
          points: [
            { x: pointA.x, y: pointA.y },
            { x: pointB.x, y: pointB.y },
          ],
          strokeColor: color,
          strokeDash,
        })
      }
    }

    return graphics
  }
}
