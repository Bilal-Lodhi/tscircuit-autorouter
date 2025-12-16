import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { doSegmentsIntersect } from "@tscircuit/math-utils"

export type HighDensitySolvabilityDiagnostics = {
  isSolvable: boolean
  numConnections: number
  numLayerChangeConnections: number
  numOverlaps: number
  numConnectionsWithCrossings: number
  totalCrossings: number
  totalViasNeeded: number
  effectiveViasUsed: number
  viaDiameter: number
  obstacleMargin: number
  viaFootprint: number
  requiredSpan: number
  nodeWidth: number
  nodeHeight: number
}

export interface IsHighDensityNodeSolvableParams {
  node: NodeWithPortPoints
  viaDiameter?: number
  traceWidth?: number
  obstacleMargin?: number
}

/**
 * Checks if a high-density node is solvable before attempting to route it.
 *
 * This function detects "obviously impossible" high-density routing problems
 * to avoid wasting time on unsolvable cases. It performs three main checks:
 *
 * 1. **Overlapping port points**: Checks if any two port points from DIFFERENT connections
 *    on the same layer are too close. Overlap tolerance is calculated as:
 *    - If `traceWidth` provided: `1.1 * traceWidth` (preferred, physically accurate)
 *    - Otherwise fallback: `viaDiameter/2 + obstacleMargin` (for backward compatibility)
 *    Note: Same-connection ports (entry/exit pairs) are allowed to be close together.
 *
 * 2. **Crossing detection**: Detects if connection paths (entry to exit line segments)
 *    intersect on the same layer. Connections are formed by taking the first port
 *    as entry and last port as exit for each connection name. Only segments that
 *    lie entirely on the same layer (entry.z == exit.z) are checked for 2D intersection.
 *
 * 3. **Via capacity**: Calculates required vias based on actual crossings and layer changes:
 *    - 2 vias per crossing (one trace goes down to another layer and comes back up)
 *    - +1 via per connection with explicit layer change (ports at different positions on different layers)
 *    - Multi-layer ports at the same (x,y) position are treated as "free vias" and don't count
 *    - Formula: `totalVias = totalCrossings * 2 + numLayerChangeConnections`
 *    - For solvability check, caps effective vias at 3 (beyond that routing is too variable to predict)
 *    - Checks if EITHER width OR height can accommodate the via row with proper spacing
 *    - Required span: `effectiveVias * (viaDiameter + 2*obstacleMargin)`
 *
 * @param params - Object containing node and optional parameters:
 *   - node: The capacity mesh node with port points to check
 *   - viaDiameter: Diameter of vias in mm (default: 0.6)
 *   - traceWidth: Width of traces in mm (default: undefined, uses fallback formula)
 *   - obstacleMargin: Safety margin around obstacles in mm (default: 0.1)
 * @returns Diagnostics object with solvability status and detailed metrics
 */
export function isHighDensityNodeSolvable(
  params: IsHighDensityNodeSolvableParams,
): HighDensitySolvabilityDiagnostics {
  const { node, viaDiameter = 0.6, traceWidth, obstacleMargin = 0.1 } = params
  const { portPoints, width } = node

  // Check 1: Detect overlapping port points on same layer
  // Use 1.5 * traceWidth if available, otherwise fallback to viaDiameter/2 + obstacleMargin
  const overlapTolerance =
    traceWidth != null ? 1.1 * traceWidth : viaDiameter / 2 + obstacleMargin
  let numOverlaps = 0

  for (let i = 0; i < portPoints.length; i++) {
    for (let j = i + 1; j < portPoints.length; j++) {
      const p1 = portPoints[i]
      const p2 = portPoints[j]

      // Skip if same connection (entry/exit of same trace can be close)
      if (p1.connectionName === p2.connectionName) continue

      // Only check if on same layer
      if (p1.z !== p2.z) continue

      const dx = p1.x - p2.x
      const dy = p1.y - p2.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < overlapTolerance) {
        numOverlaps++
      }
    }
  }

  // Check 2: Verify node width can fit required vias

  // Group ports by connection name
  const connectionMap = new Map<string, typeof portPoints>()

  for (const port of portPoints) {
    if (!connectionMap.has(port.connectionName)) {
      connectionMap.set(port.connectionName, [])
    }
    connectionMap.get(port.connectionName)!.push(port)
  }

  const numConnections = connectionMap.size

  // Build connection segments (entry to exit lines)
  const connectionSegments: Array<{
    connectionName: string
    entry: (typeof portPoints)[0]
    exit: (typeof portPoints)[0]
  }> = []

  for (const [connectionName, ports] of connectionMap.entries()) {
    if (ports.length < 2) continue // Need at least 2 ports for a segment
    // Assume first port is entry, last is exit
    const entry = ports[0]
    const exit = ports[ports.length - 1]
    connectionSegments.push({ connectionName, entry, exit })
  }

  // Detect crossings between connections on same layer
  const connectionsWithCrossings = new Set<string>()
  let totalCrossings = 0

  for (let i = 0; i < connectionSegments.length; i++) {
    for (let j = i + 1; j < connectionSegments.length; j++) {
      const seg1 = connectionSegments[i]
      const seg2 = connectionSegments[j]

      // Check if segments are on same layer
      // Both entry and exit must be on same z for a valid 2D crossing check
      if (
        seg1.entry.z === seg1.exit.z &&
        seg2.entry.z === seg2.exit.z &&
        seg1.entry.z === seg2.entry.z
      ) {
        // Check 2D line segment intersection
        if (doSegmentsIntersect(seg1.entry, seg1.exit, seg2.entry, seg2.exit)) {
          connectionsWithCrossings.add(seg1.connectionName)
          connectionsWithCrossings.add(seg2.connectionName)
          totalCrossings++
        }
      }
    }
  }

  // Count connections with explicit layer changes
  // Multi-layer ports at the same (x,y) are "free vias" and should not be counted
  let numLayerChangeConnections = 0
  for (const ports of connectionMap.values()) {
    // Group ports by (x,y) position to detect multi-layer pads
    const positionMap = new Map<string, Set<number>>()
    for (const port of ports) {
      const posKey = `${port.x.toFixed(6)},${port.y.toFixed(6)}`
      if (!positionMap.has(posKey)) {
        positionMap.set(posKey, new Set())
      }
      positionMap.get(posKey)!.add(port.z)
    }

    // Check if connection needs vias for layer changes
    // Only count as layer change if ports at different positions are on different layers
    const uniquePositions = Array.from(positionMap.values())
    const allLayers = new Set<number>()
    uniquePositions.forEach((layers) => {
      layers.forEach((z) => allLayers.add(z))
    })

    // If connection spans multiple layers AND has more than one unique position,
    // it needs vias (unless all multi-layer ports are co-located)
    if (allLayers.size > 1 && uniquePositions.length > 1) {
      // Check if all positions share at least one common layer
      let hasCommonLayer = false
      if (allLayers.size === 2) {
        // For 2 layers, check if any position has both layers (multi-layer pad)
        for (const layers of positionMap.values()) {
          if (layers.size > 1) {
            hasCommonLayer = true
            break
          }
        }
      } else if (allLayers.size > 2) {
        // For 3+ layers, check if any position has all layers (multi-layer pad spanning all connection layers)
        for (const layers of positionMap.values()) {
          if (layers.size === allLayers.size) {
            hasCommonLayer = true
            break
          }
        }
      }
      // Only count as layer change if positions don't have free vias connecting them
      if (!hasCommonLayer) {
        numLayerChangeConnections++
      }
    }
  }

  // Calculate total vias needed:
  // - 2 vias per crossing (one trace goes down and back up)
  // - +1 via per connection with explicit layer change
  const totalViasNeeded = totalCrossings * 2 + numLayerChangeConnections

  // Check if node dimensions can accommodate vias
  const viaFootprint = viaDiameter + 2 * obstacleMargin

  // Cap effective vias at 3 - beyond that, routing becomes highly variable
  // and we can't reliably predict impossibility
  const effectiveViasUsed = Math.min(totalViasNeeded, 3)
  const requiredSpan = effectiveViasUsed * viaFootprint

  // Allow packing along either width or height
  const canFitInWidth = width >= requiredSpan
  const canFitInHeight = node.height >= requiredSpan

  const isSolvable = numOverlaps === 0 && (canFitInWidth || canFitInHeight)

  return {
    isSolvable,
    numConnections,
    numLayerChangeConnections,
    numOverlaps,
    numConnectionsWithCrossings: connectionsWithCrossings.size,
    totalCrossings,
    totalViasNeeded,
    effectiveViasUsed,
    viaDiameter,
    obstacleMargin,
    viaFootprint,
    requiredSpan,
    nodeWidth: width,
    nodeHeight: node.height,
  }
}
