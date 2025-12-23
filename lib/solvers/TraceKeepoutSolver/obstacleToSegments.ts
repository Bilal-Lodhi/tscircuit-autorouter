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
