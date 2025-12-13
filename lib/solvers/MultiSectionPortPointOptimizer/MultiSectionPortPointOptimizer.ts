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
} from "../PortPointPathingSolver/PortPointPathingSolver"
import { PortPointPathingSolver } from "../PortPointPathingSolver/PortPointPathingSolver"
import {
  createPortPointSection,
  type CreatePortPointSectionInput,
  type PortPointSection,
  type PortPointSectionParams,
} from "./createPortPointSection"
import type { PortPoint, NodeWithPortPoints } from "../../types/high-density-types"

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

  /** Current section being optimized */
  currentSectionIndex = 0

  /** Section solver currently running */
  activeSectionSolver: PortPointPathingSolver | null = null

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

  _step() {
    // For now, this solver does nothing (placeholder for future optimization)
    // The actual optimization logic will be added later
    this.solved = true
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw all nodes
    for (const node of this.inputNodes) {
      graphics.rects!.push({
        center: node.center,
        width: node.width * 0.9,
        height: node.height * 0.9,
        fill: "rgba(200, 200, 200, 0.3)",
        label: node.capacityMeshNodeId,
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
