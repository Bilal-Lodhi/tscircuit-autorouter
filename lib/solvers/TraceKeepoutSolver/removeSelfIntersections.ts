interface Point3D {
  x: number
  y: number
  z: number
}

/**
 * Finds the intersection point between two line segments, if it exists.
 * Returns null if the segments don't intersect.
 */
function getSegmentIntersection(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): { x: number; y: number } | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y

  const cross = d1x * d2y - d1y * d2x

  // Parallel lines
  if (Math.abs(cross) < 1e-10) {
    return null
  }

  const dx = p3.x - p1.x
  const dy = p3.y - p1.y

  const t = (dx * d2y - dy * d2x) / cross
  const u = (dx * d1y - dy * d1x) / cross

  // Check if intersection is within both segments (excluding endpoints for self-intersection)
  const epsilon = 1e-6
  if (t > epsilon && t < 1 - epsilon && u > epsilon && u < 1 - epsilon) {
    return {
      x: p1.x + t * d1x,
      y: p1.y + t * d1y,
    }
  }

  return null
}

/**
 * Removes self-intersections from a route by finding where the path crosses itself
 * and creating a shortcut at the intersection point.
 *
 * When a self-intersection is detected, the loop between the two intersecting
 * segments is removed, and a new point is created at the intersection.
 */
export function removeSelfIntersections(route: Point3D[]): Point3D[] {
  if (route.length < 4) {
    return route
  }

  let result = [...route]
  let foundIntersection = true

  // Keep removing intersections until none are found
  while (foundIntersection) {
    foundIntersection = false

    // Check all pairs of non-adjacent segments
    for (let i = 0; i < result.length - 1 && !foundIntersection; i++) {
      const seg1Start = result[i]!
      const seg1End = result[i + 1]!

      // Skip if segment spans different layers
      if (seg1Start.z !== seg1End.z) {
        continue
      }

      // Start at i + 2 to skip adjacent segments
      for (let j = i + 2; j < result.length - 1 && !foundIntersection; j++) {
        // Skip the segment that shares a point with segment i
        if (j === i + 1) continue

        const seg2Start = result[j]!
        const seg2End = result[j + 1]!

        // Skip if segment spans different layers or is on a different layer
        if (seg2Start.z !== seg2End.z || seg1Start.z !== seg2Start.z) {
          continue
        }

        const intersection = getSegmentIntersection(
          seg1Start,
          seg1End,
          seg2Start,
          seg2End,
        )

        if (intersection) {
          // Found a self-intersection!
          // Create new route: keep points 0 to i, add intersection point, keep points j+1 to end
          const newRoute: Point3D[] = []

          // Add points from start to segment i (inclusive)
          for (let k = 0; k <= i; k++) {
            newRoute.push(result[k]!)
          }

          // Add the intersection point
          newRoute.push({
            x: intersection.x,
            y: intersection.y,
            z: seg1Start.z,
          })

          // Add points from after segment j to end
          for (let k = j + 1; k < result.length; k++) {
            newRoute.push(result[k]!)
          }

          result = newRoute
          foundIntersection = true
        }
      }
    }
  }

  return result
}
