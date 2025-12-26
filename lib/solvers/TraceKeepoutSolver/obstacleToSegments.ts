interface Point2D {
  x: number
  y: number
}

export interface Segment {
  start: Point2D
  end: Point2D
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

/**
 * Checks if a segment is within the search radius of a point
 */
function segmentIsNearPoint(
  segment: { start: Point2D; end: Point2D },
  point: Point2D,
  radius: number,
): boolean {
  // Check if either endpoint is within radius
  const d1 = Math.hypot(segment.start.x - point.x, segment.start.y - point.y)
  const d2 = Math.hypot(segment.end.x - point.x, segment.end.y - point.y)
  if (d1 <= radius || d2 <= radius) return true

  // Check if the closest point on the segment is within radius
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return false

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) /
        lenSq,
    ),
  )
  const closestX = segment.start.x + t * dx
  const closestY = segment.start.y + t * dy
  const dist = Math.hypot(closestX - point.x, closestY - point.y)

  return dist <= radius
}

/**
 * Converts route segments near a point to outline segments
 * Only processes segments that are within the search radius
 */
export function routeToOutlineSegmentsNearPoint(
  route: Array<{ x: number; y: number }>,
  traceWidth: number,
  point: Point2D,
  searchRadius: number,
): Segment[] {
  const segments: Segment[] = []

  for (let i = 0; i < route.length - 1; i++) {
    const start = route[i]!
    const end = route[i + 1]!

    // Check if this route segment is near the point
    if (segmentIsNearPoint({ start, end }, point, searchRadius + traceWidth)) {
      segments.push(...traceSegmentToOutlineSegments(start, end, traceWidth))
    }
  }

  return segments
}
