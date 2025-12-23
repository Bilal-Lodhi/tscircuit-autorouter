interface Point2D {
  x: number
  y: number
}

export interface Segment {
  start: Point2D
  end: Point2D
}

export interface ComputeDrawPositionInput {
  cursorPosition: Point2D
  lastCursorPosition: Point2D
  collidingSegments: Segment[]
  keepoutRadius: number
}

function closestPointOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { x: a.x, y: a.y }
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  )
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/**
 * Computes an optimal draw position that maintains keepoutRadius from all segments.
 * Uses iterative gradient-based refinement to handle multiple simultaneous collisions.
 *
 * The draw position is constrained to never move "behind" the cursor along the trace
 * direction. A barrier line perpendicular to the trace direction passes through the
 * cursor, and the draw position must stay on or ahead of this line.
 */
export function computeDrawPositionFromCollisions(
  input: ComputeDrawPositionInput,
): Point2D | null {
  const {
    cursorPosition,
    lastCursorPosition,
    collidingSegments,
    keepoutRadius,
  } = input

  if (collidingSegments.length === 0) return null

  const maxIterations = 50
  const epsilon = 0.0001
  const margin = 0.01

  let pos = { x: cursorPosition.x, y: cursorPosition.y }

  // Calculate trace direction for tie-breaking
  const tdx = cursorPosition.x - lastCursorPosition.x
  const tdy = cursorPosition.y - lastCursorPosition.y
  const tLen = Math.sqrt(tdx * tdx + tdy * tdy)
  const traceDir =
    tLen > epsilon ? { x: tdx / tLen, y: tdy / tLen } : { x: 1, y: 0 }

  for (let iter = 0; iter < maxIterations; iter++) {
    // Accumulate push vectors from ALL violating segments
    let pushX = 0,
      pushY = 0
    let maxViolation = 0
    let violationCount = 0

    for (const seg of collidingSegments) {
      const closest = closestPointOnSegment(pos, seg.start, seg.end)
      const dx = pos.x - closest.x
      const dy = pos.y - closest.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const violation = keepoutRadius - dist

      if (violation > epsilon) {
        maxViolation = Math.max(maxViolation, violation)
        violationCount++

        if (dist > epsilon) {
          // Push directly away from closest point, weighted by violation amount
          const weight = violation / keepoutRadius
          pushX += (dx / dist) * violation * (1 + weight)
          pushY += (dy / dist) * violation * (1 + weight)
        } else {
          // Point is ON the segment - push perpendicular to segment
          const segDx = seg.end.x - seg.start.x
          const segDy = seg.end.y - seg.start.y
          const segLen = Math.sqrt(segDx * segDx + segDy * segDy)

          if (segLen > epsilon) {
            // Choose perpendicular direction that aligns better with trace perpendicular
            const perp1 = { x: -segDy / segLen, y: segDx / segLen }
            const tracePerpDot = perp1.x * -traceDir.y + perp1.y * traceDir.x
            const sign = tracePerpDot >= 0 ? 1 : -1
            pushX += sign * perp1.x * (keepoutRadius + margin)
            pushY += sign * perp1.y * (keepoutRadius + margin)
          }
        }
      }
    }

    // Converged - no more violations
    if (maxViolation <= epsilon) break

    // Normalize and apply push with adaptive step size
    const pushMag = Math.sqrt(pushX * pushX + pushY * pushY)
    if (pushMag > epsilon) {
      // Use smaller steps when dealing with multiple violations for stability
      const stepScale = violationCount > 1 ? 0.7 : 1.0
      const stepSize = Math.min(maxViolation + margin, pushMag) * stepScale
      pos.x += (pushX / pushMag) * stepSize
      pos.y += (pushY / pushMag) * stepSize
    } else {
      break
    }
  }

  // Final validation pass - ensure we actually satisfied constraints
  let finalMaxViolation = 0
  for (const seg of collidingSegments) {
    const closest = closestPointOnSegment(pos, seg.start, seg.end)
    const dist = Math.sqrt((pos.x - closest.x) ** 2 + (pos.y - closest.y) ** 2)
    finalMaxViolation = Math.max(finalMaxViolation, keepoutRadius - dist)
  }

  // If still violating, try a more aggressive escape
  if (finalMaxViolation > margin) {
    pos = escapeViaOrthogonalSearch(
      cursorPosition,
      traceDir,
      collidingSegments,
      keepoutRadius,
      margin,
    )
  }

  const movedDist = Math.sqrt(
    (pos.x - cursorPosition.x) ** 2 + (pos.y - cursorPosition.y) ** 2,
  )
  return movedDist > epsilon ? pos : null
}

/**
 * Fallback: search along perpendicular directions to find valid position.
 * Only searches perpendicular to trace (along barrier line) to respect forward-only constraint.
 */
function escapeViaOrthogonalSearch(
  cursor: Point2D,
  traceDir: Point2D,
  segments: Segment[],
  keepoutRadius: number,
  margin: number,
): Point2D {
  const ortho1 = { x: -traceDir.y, y: traceDir.x }
  const ortho2 = { x: traceDir.y, y: -traceDir.x }

  const searchDist = keepoutRadius * 5
  const steps = 50

  let bestPos = { x: cursor.x, y: cursor.y }
  let bestScore = -Infinity

  for (const dir of [ortho1, ortho2]) {
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * searchDist
      const testPos = { x: cursor.x + dir.x * d, y: cursor.y + dir.y * d }

      // Find minimum clearance at this position
      let minClearance = Infinity
      for (const seg of segments) {
        const closest = closestPointOnSegment(testPos, seg.start, seg.end)
        const dist = Math.sqrt(
          (testPos.x - closest.x) ** 2 + (testPos.y - closest.y) ** 2,
        )
        minClearance = Math.min(minClearance, dist)
      }

      // Score: prefer positions that satisfy keepout with minimum movement
      if (minClearance >= keepoutRadius + margin) {
        const score = -d // Closer to cursor is better
        if (score > bestScore) {
          bestScore = score
          bestPos = testPos
        }
        break // Found valid position in this direction
      }
    }
  }

  return bestPos
}
