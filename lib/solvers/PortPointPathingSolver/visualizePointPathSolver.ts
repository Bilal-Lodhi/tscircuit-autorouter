import type { GraphicsObject } from "graphics-debug"
import type { PortPointPathingSolver } from "./PortPointPathingSolver"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import { safeTransparentize } from "../colors"
import type { PortPointCandidate } from "./PortPointPathingSolver"

export function visualizePointPathSolver(
  solver: PortPointPathingSolver,
): GraphicsObject {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
    rects: [],
    circles: [],
  }

  // Draw nodes with pf coloring
  for (const node of solver.inputNodes) {
    const pf = solver.computeNodePf(node)
    const red = Math.min(255, Math.floor(pf * 512))
    const green = Math.max(0, 255 - Math.floor(pf * 512))
    const color = `rgba(${red}, ${green}, 0, 0.3)`

    const nodeWithPortPoints = solver.buildNodeWithPortPointsForCrossing(node)
    const crossings = getIntraNodeCrossings(nodeWithPortPoints)

    graphics.rects!.push({
      center: node.center,
      width: node.width * 0.9,
      height: node.height * 0.9,
      layer: `z${node.availableZ.join(",")}`,
      fill: color,
      label: `${node.capacityMeshNodeId}\npf: ${pf.toFixed(3)}\nxSame: ${crossings.numSameLayerCrossings}, xLC: ${crossings.numEntryExitLayerChanges}, xTransition: ${crossings.numTransitionPairCrossings}`,
    })
  }

  // Draw all input port points
  for (const [portPointId, portPoint] of solver.portPointMap) {
    const assignment = solver.assignedPortPoints.get(portPointId)
    const color = assignment
      ? (solver.colorMap[assignment.connectionName] ?? "blue")
      : "rgba(150, 150, 150, 0.5)"

    graphics.circles!.push({
      center: { x: portPoint.x, y: portPoint.y },
      radius: 0.05,
      fill: color,
      layer: `z${portPoint.z}`,
      label: assignment
        ? `${portPointId}\n${assignment.connectionName}`
        : portPointId,
    })
  }

  // Draw solved paths
  for (const result of solver.connectionsWithResults) {
    if (!result.path) continue

    const connection = result.connection
    const color = solver.colorMap[connection.name] ?? "blue"

    // Build segment points from path
    const segmentPoints: Array<{ x: number; y: number; z: number }> = []
    for (const candidate of result.path) {
      segmentPoints.push({
        x: candidate.point.x,
        y: candidate.point.y,
        z: candidate.z,
      })
    }

    // Draw segments between consecutive points
    // strokeDash convention:
    // - top layer (z=0): solid (undefined)
    // - bottom layer (z=1): long dash "10 5"
    // - transition between layers: mixed dash "3 3 10"
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

  // While actively solving, draw the top 10 most promising candidates
  if (!solver.solved && solver.candidates && solver.candidates.length > 0) {
    const currentConnection =
      solver.connectionsWithResults[solver.currentConnectionIndex]
    const connectionColor = currentConnection
      ? (solver.colorMap[currentConnection.connection.name] ?? "blue")
      : "blue"

    const sortedCandidates = [...solver.candidates]
      .sort((a, b) => a.f - b.f)
      .slice(0, 10)

    for (const candidate of sortedCandidates) {
      const candidatePath: Array<{ x: number; y: number; z: number }> = []
      let current: PortPointCandidate | null = candidate
      while (current) {
        candidatePath.unshift({
          x: current.point.x,
          y: current.point.y,
          z: current.z,
        })
        current = current.prevCandidate
      }

      // Draw each segment with strokeDash convention based on z
      for (let i = 0; i < candidatePath.length - 1; i++) {
        const pointA = candidatePath[i]
        const pointB = candidatePath[i + 1]

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
          strokeColor: safeTransparentize(connectionColor, 0.25),
          strokeDash,
        })
      }

      if (candidatePath.length >= 1) {
        const head = candidatePath[candidatePath.length - 1]
        graphics.circles!.push({
          center: head,
          radius: 0.03,
          fill: safeTransparentize(connectionColor, 0.25),
          layer: `z${candidate.z}`,
          label: [
            `f: ${candidate.f.toFixed(2)}`,
            `g: ${candidate.g.toFixed(2)}`,
            `h: ${candidate.h.toFixed(2)}`,
            `z: ${candidate.z}`,
            `node: ${candidate.currentNodeId}`,
          ].join("\n"),
        })
      }
    }
  }

  return graphics
}
