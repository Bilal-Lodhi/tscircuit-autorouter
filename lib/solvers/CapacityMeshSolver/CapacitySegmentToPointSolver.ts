import { BaseSolver } from "../BaseSolver"
import type { NodePortSegment } from "../../types/capacity-edges-to-port-segments-types"
import type { GraphicsObject, Line } from "graphics-debug"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import type { CapacityMeshNode, CapacityMeshNodeId, CapacityPath } from "lib/types"

export interface SegmentWithAssignedPoints extends NodePortSegment {
  assignedPoints?: {
    connectionName: string
    point: { x: number; y: number; z: number }
  }[]
}

/**
 * CapacitySegmentToPointSolver:
 *
 * In each step, the solver iterates over all unsolved segments (segments
 * without points assigned for each connection). For each segment:
 *
 * - If there is only one connection, it assigns the center as the point.
 * - If there are two connections, it attempts to determine the ordering using
 *   other segments within the node. If no ordering can be determined, it does nothing.
 *
 * If an iteration produces no new assignments, the solver picks the segment with
 * the fewest connections and assigns points evenly spaced along the segment,
 * ordering them alphabetically.
 */
export class CapacitySegmentToPointSolver extends BaseSolver {
  unsolvedSegments: SegmentWithAssignedPoints[]
  solvedSegments: (NodePortSegment & {
    assignedPoints: {
      connectionName: string
      point: { x: number; y: number; z: number }
    }[]
  })[]
  nodeMap: Record<string, CapacityMeshNode>
  colorMap: Record<string, string>
  /** Map of connectionName to chosen layer info from A* pathfinding */
  capacityPathLayerMap: Map<string, { startZ?: number; endZ?: number; startNodeId?: string; endNodeId?: string }>

  // We use an extra property on segments to remember assigned points.
  // Each segment will get an added property "assignedPoints" which is an array of:
  // { connectionName: string, point: {x: number, y: number } }
  // This is a temporary extension used by the solver.
  constructor({
    segments,
    colorMap,
    nodes,
    capacityPaths,
  }: {
    segments: NodePortSegment[]
    colorMap?: Record<string, string>
    /**
     * This isn't used by the algorithm, but allows associating metadata
     * for the result datatype (the center, width, height of the node)
     */
    nodes: CapacityMeshNode[]
    /**
     * Capacity paths from the pathing solver, containing chosen layers for
     * connections that start/end at MultiLayerConnectionPoints
     */
    capacityPaths?: CapacityPath[]
  }) {
    super()
    this.MAX_ITERATIONS = 100_000
    this.unsolvedSegments = segments
    this.solvedSegments = []
    this.colorMap = colorMap ?? {}
    this.nodeMap = Object.fromEntries(
      nodes.map((node) => [node.capacityMeshNodeId, node]),
    )
    // Build map of connection -> layer info for quick lookup
    // Note: nodeIds are in backtracked order (end -> start), so:
    // - nodeIds[0] is the END node
    // - nodeIds[length-1] is the START node
    this.capacityPathLayerMap = new Map()
    if (capacityPaths) {
      for (const path of capacityPaths) {
        if (path.startZ !== undefined || path.endZ !== undefined) {
          this.capacityPathLayerMap.set(path.connectionName, {
            startZ: path.startZ,
            endZ: path.endZ,
            // nodeIds are backtracked: [end, ..., start]
            startNodeId: path.nodeIds[path.nodeIds.length - 1],
            endNodeId: path.nodeIds[0],
          })
        }
      }
    }
  }

  /**
   * Get the optimal z-layer for a connection at a specific node.
   * Uses chosen layer from A* pathfinding if available, otherwise falls back to first available.
   *
   * IMPORTANT: For connections with MLCP endpoints, we use the chosen layer for ALL nodes
   * along the path (not just start/end) to maintain layer consistency and avoid unnecessary vias.
   */
  getOptimalZ(seg: NodePortSegment, connectionName: string): number {
    const pathInfo = this.capacityPathLayerMap.get(connectionName)
    if (pathInfo) {
      // For connections with MLCP endpoints, use the chosen layer for ALL nodes in the path
      // This maintains layer consistency and avoids vias at node boundaries
      const chosenLayer = pathInfo.startZ ?? pathInfo.endZ
      if (chosenLayer !== undefined && seg.availableZ.includes(chosenLayer)) {
        return chosenLayer
      }
    }
    // Default to first available layer
    return seg.availableZ[0]
  }

  /**
   * Perform one iteration step.
   */
  _step() {
    let updated = false
    // unsolved segments: segments without complete assignments.
    const unsolved = [...this.unsolvedSegments]

    // Iterate over unsolved segments.
    for (const seg of unsolved) {
      const n = seg.connectionNames.length
      // Already processed? Skip if assignedPoints exists for all connections.
      if ("assignedPoints" in seg && seg.assignedPoints?.length === n) continue

      if (n === 1) {
        // For a single connection, assign the center of the segment.
        const connectionName = seg.connectionNames[0]
        const center = {
          x: (seg.start.x + seg.end.x) / 2,
          y: (seg.start.y + seg.end.y) / 2,
          z: this.getOptimalZ(seg, connectionName),
        }
        ;(seg as any).assignedPoints = [
          { connectionName, point: center },
        ]
        // Move seg from unsolvedSegments to solvedSegments.
        this.unsolvedSegments.splice(this.unsolvedSegments.indexOf(seg), 1)
        this.solvedSegments.push(seg as any)
        updated = true
      }
    }

    // If no segments were updated in this iteration, perform a fallback.
    if (!updated && unsolved.length > 0) {
      // Choose the unsolved segment with the fewest connections.
      let candidate = unsolved[0]
      for (const seg of unsolved) {
        if (seg.connectionNames.length < candidate.connectionNames.length) {
          candidate = seg
        }
      }
      // Fallback: assign points evenly spaced along the segment,
      // after sorting connection names alphabetically.
      const sortedConnections = [...candidate.connectionNames].sort()
      const dx = candidate.end.x - candidate.start.x
      const dy = candidate.end.y - candidate.start.y
      const n = sortedConnections.length
      const assignedPoints: { connectionName: string; point: { x: number; y: number; z: number } }[] = []
      // Evenly space positions using fractions of the segment distance.
      for (let i = 0; i < n; i++) {
        const fraction = (i + 1) / (n + 1)
        const conn = sortedConnections[i]
        assignedPoints.push({
          connectionName: conn,
          point: {
            x: candidate.start.x + dx * fraction,
            y: candidate.start.y + dy * fraction,
            z: this.getOptimalZ(candidate, conn),
          },
        })
      }
      ;(candidate as any).assignedPoints = assignedPoints
      // Move candidate from unsolvedSegments to solvedSegments.
      this.unsolvedSegments.splice(this.unsolvedSegments.indexOf(candidate), 1)
      this.solvedSegments.push(candidate as any)
      updated = true
    }

    // If all segments have been assigned points, mark solved.
    if (this.unsolvedSegments.length === 0) {
      this.solved = true
    }
  }

  /**
   * Return the assigned points for each segment.
   */
  getNodesWithPortPoints(): NodeWithPortPoints[] {
    if (!this.solved) {
      throw new Error(
        "CapacitySegmentToPointSolver not solved, can't give port points yet",
      )
    }
    const map = new Map<string, NodeWithPortPoints>()
    for (const seg of this.solvedSegments) {
      const nodeId = seg.capacityMeshNodeId
      const node = this.nodeMap[nodeId]
      if (!map.has(nodeId)) {
        map.set(nodeId, {
          capacityMeshNodeId: nodeId,
          portPoints: [],
          center: node.center,
          width: node.width,
          height: node.height,
          // Always include availableZ so HighDensitySolver knows all available layers
          availableZ: node.availableZ,
        })
      }
      map.get(nodeId)!.portPoints.push(
        ...seg.assignedPoints.map((ap) => ({
          ...ap.point,
          connectionName: ap.connectionName,
          // Include availableZ on port points at MLCP nodes for flexible layer selection
          availableZ: node._isMultiLayerConnectionPoint ? node.availableZ : undefined,
        })),
      )
    }
    return Array.from(map.values())
  }

  /**
   * Return a GraphicsObject that visualizes the segments with assigned points.
   */
  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: this.solvedSegments.map((seg) => ({
        points: [seg.start, seg.end],
        step: 4,
      })),
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Capacity Segment to Point Solver",
    }

    // Add points for each assigned point on solved segments
    for (let i = 0; i < this.solvedSegments.length; i++) {
      const seg = this.solvedSegments[i]
      for (let j = 0; j < seg.assignedPoints.length; j++) {
        const ap = seg.assignedPoints[j]

        // Calculate the true position and the offset position (if z != 0)
        const truePoint = {
          x: ap.point.x,
          y: ap.point.y,
        }

        const offsetPoint = {
          x: ap.point.x + ap.point.z * 0.05,
          y: ap.point.y + ap.point.z * 0.05,
        }

        // Add a dashed line to show the true position if there's an offset
        if (ap.point.z !== 0) {
          graphics.lines!.push({
            points: [truePoint, offsetPoint],
            strokeColor: "rgba(0, 0, 0, 0.25)",
            strokeDash: "5 5",
            step: 4,
          })
        }

        // Add the point with label
        graphics.points!.push({
          x: offsetPoint.x,
          y: offsetPoint.y,
          label: [
            `${seg.capacityMeshNodeId}-${ap.connectionName}`,
            `z: ${seg.availableZ.join(",")}`,
            `nodePortSegmentId: ${seg.nodePortSegmentId}`,
          ].join("\n"),
          color: this.colorMap[ap.connectionName],
          step: 4,
        })
      }
    }

    // Add a dashed line connecting the assignment points with the same
    // connection name within the same node
    const dashedLines: Line[] = []
    const nodeConnections: Record<
      CapacityMeshNodeId,
      Record<string, { x: number; y: number }[]>
    > = {}
    for (const seg of this.solvedSegments) {
      const nodeId = seg.capacityMeshNodeId
      if (!nodeConnections[nodeId]) {
        nodeConnections[nodeId] = {}
      }
      for (const ap of seg.assignedPoints) {
        if (!nodeConnections[nodeId][ap.connectionName]) {
          nodeConnections[nodeId][ap.connectionName] = []
        }
        nodeConnections[nodeId][ap.connectionName].push({
          x: ap.point.x,
          y: ap.point.y,
        })
      }
    }
    for (const nodeId in nodeConnections) {
      for (const conn in nodeConnections[nodeId]) {
        const points = nodeConnections[nodeId][conn]
        if (points.length > 1) {
          dashedLines.push({
            points,
            step: 4,
            strokeDash: "5 5",
            strokeColor: this.colorMap[conn] || "#000",
          } as Line)
        }
      }
    }
    graphics.lines!.push(...dashedLines)

    return graphics
  }
}
