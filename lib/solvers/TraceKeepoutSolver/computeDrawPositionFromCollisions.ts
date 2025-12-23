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

/**
 * Finds the closest point on a line segment to a given point
 */
function closestPointOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) return { x: a.x, y: a.y }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  return {
    x: a.x + t * dx,
    y: a.y + t * dy,
  }
}

/**
 * Finds the closest point among all segments to the cursor position
 */
function findClosestPointOnSegments(
  cursorPosition: Point2D,
  segments: Segment[],
): Point2D | null {
  let closestX = 0
  let closestY = 0
  let closestDistSq = Infinity
  let hasClosest = false

  for (const segment of segments) {
    const closest = closestPointOnSegment(
      cursorPosition,
      segment.start,
      segment.end,
    )
    const distSq =
      (closest.x - cursorPosition.x) ** 2 +
      (closest.y - cursorPosition.y) ** 2
    if (distSq < closestDistSq) {
      closestDistSq = distSq
      closestX = closest.x
      closestY = closest.y
      hasClosest = true
    }
  }

  if (!hasClosest) return null
  return { x: closestX, y: closestY }
}

/**
 * Calculates the avoidance vector to push the draw position away from obstacles
 * Moves the minimum amount needed to get obstacles outside the keepout radius
 */
function calculateAvoidanceVector(
  cursorPosition: Point2D,
  traceDirection: Point2D,
  closestObstaclePoint: Point2D,
  keepoutRadius: number,
): Point2D | null {
  // Calculate orthogonal directions (perpendicular to trace)
  const orthogonal1 = { x: -traceDirection.y, y: traceDirection.x }
  const orthogonal2 = { x: traceDirection.y, y: -traceDirection.x }

  // Vector from cursor to closest obstacle point
  const toObstacle = {
    x: closestObstaclePoint.x - cursorPosition.x,
    y: closestObstaclePoint.y - cursorPosition.y,
  }
  const distToObstacle = Math.sqrt(toObstacle.x ** 2 + toObstacle.y ** 2)

  // If already outside keepout radius, no movement needed
  if (distToObstacle >= keepoutRadius) {
    return null
  }

  // Choose which orthogonal direction points away from the obstacle
  const dot1 = orthogonal1.x * toObstacle.x + orthogonal1.y * toObstacle.y
  const dot2 = orthogonal2.x * toObstacle.x + orthogonal2.y * toObstacle.y
  const pushDir = dot1 < dot2 ? orthogonal1 : orthogonal2

  // Calculate the perpendicular component of toObstacle relative to pushDir
  // d_perp = toObstacle · pushDir (how far obstacle is in the push direction)
  const d_perp = toObstacle.x * pushDir.x + toObstacle.y * pushDir.y

  // d_along = component along trace direction
  const d_along =
    toObstacle.x * traceDirection.x + toObstacle.y * traceDirection.y

  // Calculate minimum push distance needed
  // After pushing by m, new distance² = d_along² + (d_perp - m)²
  // We want new distance = keepoutRadius
  // keepoutRadius² = d_along² + (d_perp - m)²
  // (d_perp - m)² = keepoutRadius² - d_along²

  const keepoutSq = keepoutRadius ** 2
  const alongSq = d_along ** 2

  if (keepoutSq <= alongSq) {
    // Obstacle is far enough along trace direction, no orthogonal push needed
    return null
  }

  const requiredPerpDist = Math.sqrt(keepoutSq - alongSq)

  // We need |d_perp - m| >= requiredPerpDist
  // Since pushDir points away (d_perp should be negative or we push to make it more negative)
  // m = d_perp - (-requiredPerpDist) = d_perp + requiredPerpDist (if d_perp < 0)
  // m = d_perp - requiredPerpDist (if d_perp > 0, but we chose pushDir to point away so this shouldn't happen)

  let pushDistance: number
  if (d_perp <= 0) {
    // Obstacle is in opposite direction of push, push by enough to clear
    pushDistance = Math.abs(d_perp) + requiredPerpDist
  } else {
    // Obstacle is in same direction as push (shouldn't happen with correct pushDir choice)
    // Push enough to get past it
    pushDistance = requiredPerpDist - d_perp
    if (pushDistance < 0) pushDistance = 0
  }

  // Add small margin
  pushDistance += 0.01

  return {
    x: pushDir.x * pushDistance,
    y: pushDir.y * pushDistance,
  }
}

/**
 * Computes a new draw position based on collision avoidance.
 *
 * Given the cursor position, the last cursor position (to determine direction),
 * and a set of colliding segments (edges of obstacles and trace outlines),
 * this function calculates an adjusted draw position that maintains the
 * keepout radius from all collisions.
 *
 * @param input.cursorPosition - Current position along the trace
 * @param input.lastCursorPosition - Previous position (used to determine trace direction)
 * @param input.collidingSegments - Line segments representing obstacle edges and trace outlines
 * @param input.keepoutRadius - Minimum distance to maintain from obstacles
 *
 * @returns The adjusted draw position, or null if no adjustment needed
 */
export function computeDrawPositionFromCollisions(
  input: ComputeDrawPositionInput,
): Point2D | null {
  const { cursorPosition, lastCursorPosition, collidingSegments, keepoutRadius } =
    input

  if (collidingSegments.length === 0) {
    return null
  }

  // Calculate trace direction from last to current cursor position
  const dx = cursorPosition.x - lastCursorPosition.x
  const dy = cursorPosition.y - lastCursorPosition.y
  const len = Math.sqrt(dx * dx + dy * dy)

  // Default direction if positions are the same
  const traceDirection =
    len === 0 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len }

  // Find the closest point among all colliding segments
  const closestPoint = findClosestPointOnSegments(cursorPosition, collidingSegments)
  if (!closestPoint) {
    return null
  }

  // Calculate the avoidance vector
  const avoidanceVector = calculateAvoidanceVector(
    cursorPosition,
    traceDirection,
    closestPoint,
    keepoutRadius,
  )

  if (!avoidanceVector) {
    return null
  }

  // Return the new draw position
  return {
    x: cursorPosition.x + avoidanceVector.x,
    y: cursorPosition.y + avoidanceVector.y,
  }
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
    { start: topLeft, end: topRight }, // top edge
    { start: topRight, end: bottomRight }, // right edge
    { start: bottomRight, end: bottomLeft }, // bottom edge
    { start: bottomLeft, end: topLeft }, // left edge
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

  if (len === 0) {
    return []
  }

  // Normalized direction
  const nx = dx / len
  const ny = dy / len

  // Perpendicular direction
  const px = -ny
  const py = nx

  // Half width offset
  const halfW = traceWidth / 2

  // Left edge
  const leftStart = {
    x: segmentStart.x + px * halfW,
    y: segmentStart.y + py * halfW,
  }
  const leftEnd = {
    x: segmentEnd.x + px * halfW,
    y: segmentEnd.y + py * halfW,
  }

  // Right edge
  const rightStart = {
    x: segmentStart.x - px * halfW,
    y: segmentStart.y - py * halfW,
  }
  const rightEnd = {
    x: segmentEnd.x - px * halfW,
    y: segmentEnd.y - py * halfW,
  }

  return [
    { start: leftStart, end: leftEnd },
    { start: rightStart, end: rightEnd },
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
    const start = route[i]!
    const end = route[i + 1]!
    segments.push(...traceSegmentToOutlineSegments(start, end, traceWidth))
  }

  return segments
}
