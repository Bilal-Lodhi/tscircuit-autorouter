import { BaseSolver } from "../BaseSolver"
import type { NodePortSegment } from "../../types/capacity-edges-to-port-segments-types"
import type { GraphicsObject, Line } from "graphics-debug"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"

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
  preferredLayerByConnection: Map<string, number>

  // We use an extra property on segments to remember assigned points.
  // Each segment will get an added property "assignedPoints" which is an array of:
  // { connectionName: string, point: {x: number, y: number } }
  // This is a temporary extension used by the solver.
  constructor({
    segments,
    colorMap,
    nodes,
  }: {
    segments: NodePortSegment[]
    colorMap?: Record<string, string>
    /**
     * This isn't used by the algorithm, but allows associating metadata
     * for the result datatype (the center, width, height of the node)
     */
    nodes: CapacityMeshNode[]
  }) {
    super()
    this.MAX_ITERATIONS = 100_000
    this.unsolvedSegments = segments
    this.solvedSegments = []
    this.colorMap = colorMap ?? {}
    this.nodeMap = Object.fromEntries(
      nodes.map((node) => [node.capacityMeshNodeId, node]),
    )

    this.preferredLayerByConnection =
      this.computePreferredLayerByConnection(segments)
  }

  /**
   * Determine the preferred layer for each connection by looking at the
   * availability across all related segments. If every segment that touches a
   * connection shares a common layer, we choose that shared layer. Otherwise we
   * fall back to the most frequently available layer for that connection.
   */
  computePreferredLayerByConnection(segments: NodePortSegment[]) {
    const intersectionByConnection = new Map<string, number[]>()
    const countsByConnection = new Map<string, Map<number, number>>()

    for (const seg of segments) {
      for (const connectionName of seg.connectionNames) {
        // Track layer intersections
        const existingIntersection =
          intersectionByConnection.get(connectionName)
        const segLayers = [...seg.availableZ]
        if (existingIntersection) {
          const intersection = existingIntersection.filter((z) =>
            segLayers.includes(z),
          )
          intersectionByConnection.set(connectionName, intersection)
        } else {
          intersectionByConnection.set(connectionName, segLayers)
        }

        // Track frequency counts for fallback
        const layerCounts =
          countsByConnection.get(connectionName) ?? new Map<number, number>()
        for (const z of segLayers) {
          layerCounts.set(z, (layerCounts.get(z) ?? 0) + 1)
        }
        countsByConnection.set(connectionName, layerCounts)
      }
    }

    const preferredLayerByConnection = new Map<string, number>()

    for (const [connectionName, layerCounts] of countsByConnection.entries()) {
      const intersection = intersectionByConnection.get(connectionName) ?? []
      if (intersection.length > 0) {
        preferredLayerByConnection.set(
          connectionName,
          [...intersection].sort((a, b) => a - b)[0],
        )
        continue
      }

      let bestLayer: number | null = null
      let bestCount = -1
      for (const [layer, count] of layerCounts.entries()) {
        if (
          count > bestCount ||
          (count === bestCount && layer < (bestLayer ?? Infinity))
        ) {
          bestLayer = layer
          bestCount = count
        }
      }

      if (bestLayer !== null) {
        preferredLayerByConnection.set(connectionName, bestLayer)
      }
    }

    return preferredLayerByConnection
  }

  getPreferredLayer(connectionName: string, availableZ: number[]) {
    const preferredLayer = this.preferredLayerByConnection.get(connectionName)
    if (preferredLayer !== undefined && availableZ.includes(preferredLayer)) {
      return preferredLayer
    }

    return availableZ[0]
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
        const preferredLayer = this.getPreferredLayer(
          seg.connectionNames[0],
          seg.availableZ,
        )
        const center = {
          x: (seg.start.x + seg.end.x) / 2,
          y: (seg.start.y + seg.end.y) / 2,
          z: preferredLayer,
        }
        ;(seg as any).assignedPoints = [
          { connectionName: seg.connectionNames[0], point: center },
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
      const points: { x: number; y: number; z: number }[] = []
      // Evenly space positions using fractions of the segment distance.
      for (let i = 1; i <= n; i++) {
        const fraction = i / (n + 1)
        points.push({
          x: candidate.start.x + dx * fraction,
          y: candidate.start.y + dy * fraction,
          z: candidate.availableZ[0],
        })
      }
      ;(candidate as any).assignedPoints = sortedConnections.map(
        (conn, idx) => ({
          connectionName: conn,
          point: {
            ...points[idx],
            z: this.getPreferredLayer(conn, candidate.availableZ),
          },
        }),
      )
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
          availableZ: node.availableZ,
        })
      }
      map.get(nodeId)!.portPoints.push(
        ...seg.assignedPoints.map((ap) => ({
          ...ap.point,
          connectionName: ap.connectionName,
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
