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
 * Gets minimum clearance from a point to all segments
 */
function getMinClearance(pos: Point2D, segments: Segment[]): number {
  let minClearance = Infinity
  for (const seg of segments) {
    const closest = closestPointOnSegment(pos, seg.start, seg.end)
    const dist = Math.sqrt((pos.x - closest.x) ** 2 + (pos.y - closest.y) ** 2)
    minClearance = Math.min(minClearance, dist)
  }
  return minClearance
}

/**
 * Checks if two line segments intersect
 */
function segmentsIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): boolean {
  const d1 = direction(b1, b2, a1)
  const d2 = direction(b1, b2, a2)
  const d3 = direction(a1, a2, b1)
  const d4 = direction(a1, a2, b2)

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true
  }

  const eps = 0.0001
  if (Math.abs(d1) < eps && onSegment(b1, b2, a1)) return true
  if (Math.abs(d2) < eps && onSegment(b1, b2, a2)) return true
  if (Math.abs(d3) < eps && onSegment(a1, a2, b1)) return true
  if (Math.abs(d4) < eps && onSegment(a1, a2, b2)) return true

  return false
}

function direction(a: Point2D, b: Point2D, c: Point2D): number {
  return (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y)
}

function onSegment(a: Point2D, b: Point2D, c: Point2D): boolean {
  return (
    c.x >= Math.min(a.x, b.x) - 0.0001 &&
    c.x <= Math.max(a.x, b.x) + 0.0001 &&
    c.y >= Math.min(a.y, b.y) - 0.0001 &&
    c.y <= Math.max(a.y, b.y) + 0.0001
  )
}

/**
 * Checks if the path from cursor to position is clear (no segments in between)
 */
function isPathClear(
  cursor: Point2D,
  pos: Point2D,
  segments: Segment[],
): boolean {
  for (const seg of segments) {
    if (segmentsIntersect(cursor, pos, seg.start, seg.end)) {
      return false
    }
  }
  return true
}

/**
 * Computes an optimal draw position that maintains keepoutRadius from all segments.
 *
 * The draw position is constrained to:
 * 1. Lie on the barrier line (perpendicular to trace direction, passing through cursor)
 * 2. Stay within keepoutRadius distance from the cursor position
 *
 * Within these constraints, it finds the position that maximizes the minimum
 * clearance to all colliding segments. This provides the "safest" position
 * even when a fully valid position (clearance >= keepoutRadius) isn't possible.
 *
 * @param input.cursorPosition - Current position along the trace
 * @param input.lastCursorPosition - Previous position (used to determine trace direction)
 * @param input.collidingSegments - Line segments representing obstacle edges and trace outlines
 * @param input.keepoutRadius - Minimum distance to maintain from obstacles (also max distance from cursor)
 *
 * @returns The optimal draw position on the barrier line within keepoutRadius, or null if cursor is valid
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

  const epsilon = 0.0001

  // Calculate trace direction
  const tdx = cursorPosition.x - lastCursorPosition.x
  const tdy = cursorPosition.y - lastCursorPosition.y
  const tLen = Math.sqrt(tdx * tdx + tdy * tdy)
  const traceDir =
    tLen > epsilon ? { x: tdx / tLen, y: tdy / tLen } : { x: 1, y: 0 }

  // Barrier direction (perpendicular to trace)
  const barrierDir = { x: -traceDir.y, y: traceDir.x }

  // Check if cursor position itself is valid
  const cursorClearance = getMinClearance(cursorPosition, collidingSegments)
  if (cursorClearance >= keepoutRadius) {
    return null // No adjustment needed
  }

  // Search outward from cursor along barrier line in both directions
  // Stop as soon as we find a valid position (minimal displacement)
  const steps = 20

  // Search both directions simultaneously, increasing distance from cursor
  for (let i = 1; i <= steps; i++) {
    const d = (i / steps) * keepoutRadius

    // Test positive direction
    const posPlus = {
      x: cursorPosition.x + barrierDir.x * d,
      y: cursorPosition.y + barrierDir.y * d,
    }
    const clearancePlus = getMinClearance(posPlus, collidingSegments)

    // Test negative direction
    const posMinus = {
      x: cursorPosition.x - barrierDir.x * d,
      y: cursorPosition.y - barrierDir.y * d,
    }
    const clearanceMinus = getMinClearance(posMinus, collidingSegments)

    // Return the first valid position found (minimal displacement)
    // Position must have sufficient clearance AND path from cursor must be clear
    const validPlus =
      clearancePlus >= keepoutRadius &&
      isPathClear(cursorPosition, posPlus, collidingSegments)
    const validMinus =
      clearanceMinus >= keepoutRadius &&
      isPathClear(cursorPosition, posMinus, collidingSegments)

    if (validPlus && validMinus) {
      return clearancePlus >= clearanceMinus ? posPlus : posMinus
    }
    if (validPlus) return posPlus
    if (validMinus) return posMinus
  }

  // No valid position found - return the best suboptimal position
  // (position with maximum clearance within the search range that has clear path)
  let bestPos: Point2D | null = null
  let bestClearance = -Infinity

  for (let i = -steps; i <= steps; i++) {
    const d = (i / steps) * keepoutRadius
    const testPos = {
      x: cursorPosition.x + barrierDir.x * d,
      y: cursorPosition.y + barrierDir.y * d,
    }

    // Only consider positions with clear path from cursor
    if (!isPathClear(cursorPosition, testPos, collidingSegments)) {
      continue
    }

    const clearance = getMinClearance(testPos, collidingSegments)
    if (clearance > bestClearance) {
      bestClearance = clearance
      bestPos = testPos
    }
  }

  // If no position has clear path, fall back to cursor position (return null)
  if (bestPos === null) {
    return null
  }

  const movedDist = Math.sqrt(
    (bestPos.x - cursorPosition.x) ** 2 + (bestPos.y - cursorPosition.y) ** 2,
  )
  return movedDist > epsilon ? bestPos : null
}
/**
 * Converts an obstacle (rectangular) to its 4 edge segments
 */
export function obstacleToSegments(obstacle: {
  center: { x: number; y: number }
  width: number
  height: number
}): Segment[] {
  const halfW = obstacle.width / 2
  const halfH = obstacle.height / 2
  const cx = obstacle.center.x
  const cy = obstacle.center.y

  const topLeft = { x: cx - halfW, y: cy + halfH }
  const topRight = { x: cx + halfW, y: cy + halfH }
  const bottomLeft = { x: cx - halfW, y: cy - halfH }
  const bottomRight = { x: cx + halfW, y: cy - halfH }

  return [
    { start: topLeft, end: topRight },
    { start: topRight, end: bottomRight },
    { start: bottomRight, end: bottomLeft },
    { start: bottomLeft, end: topLeft },
  ]
}

/**
 * Converts a trace segment to its outline segments (left and right edges)
 * considering the trace width
 */
export function traceSegmentToOutlineSegments(
  segmentStart: Point2D,
  segmentEnd: Point2D,
  traceWidth: number = 0.1,
): Segment[] {
  const dx = segmentEnd.x - segmentStart.x
  const dy = segmentEnd.y - segmentStart.y
  const len = Math.sqrt(dx * dx + dy * dy)

  if (len === 0) return []

  const nx = dx / len
  const ny = dy / len
  const px = -ny
  const py = nx
  const halfW = traceWidth / 2

  return [
    {
      start: { x: segmentStart.x + px * halfW, y: segmentStart.y + py * halfW },
      end: { x: segmentEnd.x + px * halfW, y: segmentEnd.y + py * halfW },
    },
    {
      start: { x: segmentStart.x - px * halfW, y: segmentStart.y - py * halfW },
      end: { x: segmentEnd.x - px * halfW, y: segmentEnd.y - py * halfW },
    },
  ]
}

/**
 * Converts an entire route to outline segments
 */
export function routeToOutlineSegments(
  route: Array<{ x: number; y: number }>,
  traceWidth: number = 0.1,
): Segment[] {
  const segments: Segment[] = []
  for (let i = 0; i < route.length - 1; i++) {
    segments.push(
      ...traceSegmentToOutlineSegments(route[i]!, route[i + 1]!, traceWidth),
    )
  }
  return segments
}
