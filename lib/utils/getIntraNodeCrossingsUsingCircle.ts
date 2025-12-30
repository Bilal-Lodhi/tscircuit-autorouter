import { NodeWithPortPoints } from "lib/types/high-density-types"

/**
 * Maps a boundary point to a 1D perimeter coordinate.
 * Starting at top-left corner, going clockwise:
 * - Top edge (y=ymax): t = x - xmin
 * - Right edge (x=xmax): t = W + (ymax - y)
 * - Bottom edge (y=ymin): t = 2W + H + (xmax - x)
 * - Left edge (x=xmin): t = 2W + 2H + (y - ymin)
 */
function perimeterT(
  p: { x: number; y: number },
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
): number {
  const W = xmax - xmin
  const H = ymax - ymin
  const eps = 1e-6

  // Top edge
  if (Math.abs(p.y - ymax) < eps) {
    return p.x - xmin
  }
  // Right edge
  if (Math.abs(p.x - xmax) < eps) {
    return W + (ymax - p.y)
  }
  // Bottom edge
  if (Math.abs(p.y - ymin) < eps) {
    return W + H + (xmax - p.x)
  }
  // Left edge
  if (Math.abs(p.x - xmin) < eps) {
    return 2 * W + H + (p.y - ymin)
  }

  // Point is not exactly on boundary - find closest edge
  const distTop = Math.abs(p.y - ymax)
  const distRight = Math.abs(p.x - xmax)
  const distBottom = Math.abs(p.y - ymin)
  const distLeft = Math.abs(p.x - xmin)

  const minDist = Math.min(distTop, distRight, distBottom, distLeft)

  if (minDist === distTop) {
    return Math.max(0, Math.min(W, p.x - xmin))
  }
  if (minDist === distRight) {
    return W + Math.max(0, Math.min(H, ymax - p.y))
  }
  if (minDist === distBottom) {
    return W + H + Math.max(0, Math.min(W, xmax - p.x))
  }
  // Left edge
  return 2 * W + H + Math.max(0, Math.min(H, p.y - ymin))
}

/**
 * Fenwick tree (Binary Indexed Tree) for efficient range queries
 */
class FenwickTree {
  private bit: number[]

  constructor(n: number) {
    this.bit = new Array(n + 2).fill(0)
  }

  add(i: number, delta: number = 1) {
    for (let idx = i + 1; idx < this.bit.length; idx += idx & -idx) {
      this.bit[idx] += delta
    }
  }

  sum(i: number): number {
    let s = 0
    for (let idx = i + 1; idx > 0; idx -= idx & -idx) {
      s += this.bit[idx]
    }
    return s
  }

  rangeSum(l: number, r: number): number {
    if (r < l) return 0
    return this.sum(r) - (l > 0 ? this.sum(l - 1) : 0)
  }
}

/**
 * Count necessary crossings between chords on a circle using the interleaving criterion.
 * Two chords (a,b) and (c,d) with a < b and c < d cross iff: a < c < b < d OR c < a < d < b
 *
 * Uses a Fenwick tree for O(n log n) complexity.
 */
function countChordCrossings(chords: Array<[number, number]>): number {
  if (chords.length < 2) return 0

  // Normalize each chord so first endpoint is smaller
  const normalizedChords = chords.map(([t1, t2]) =>
    t1 < t2 ? ([t1, t2] as [number, number]) : ([t2, t1] as [number, number]),
  )

  // Coordinate compress all endpoints to ranks 0..M-1
  const allCoords = Array.from(
    new Set(normalizedChords.flatMap(([a, b]) => [a, b])),
  ).sort((a, b) => a - b)

  const coordToRank = new Map<number, number>()
  allCoords.forEach((v, i) => coordToRank.set(v, i))

  // Convert chords to ranked form and sort by first endpoint
  const rankedChords = normalizedChords
    .map(
      ([a, b]) =>
        [coordToRank.get(a)!, coordToRank.get(b)!] as [number, number],
    )
    .sort((c1, c2) => c1[0] - c2[0])

  const fw = new FenwickTree(allCoords.length)
  let crossings = 0

  for (const [a, b] of rankedChords) {
    // Count previous b's strictly between a and b
    // A chord (a_prev, b_prev) crosses current (a, b) when:
    // a_prev < a < b_prev < b
    // Since we sorted by a, we know a_prev <= a.
    // So we need b_prev in range (a, b)
    crossings += fw.rangeSum(a + 1, b - 1)
    fw.add(b)
  }

  return crossings
}

/**
 * Compute intra-node crossings using the circle/perimeter mapping approach.
 *
 * This is topologically correct: two connections MUST cross if their boundary
 * points interleave around the perimeter, regardless of which side of the
 * rectangle they are on.
 *
 * Returns the same output structure as getIntraNodeCrossings.
 */
export const getIntraNodeCrossingsUsingCircle = (node: NodeWithPortPoints) => {
  const xmin = node.center.x - node.width / 2
  const xmax = node.center.x + node.width / 2
  const ymin = node.center.y - node.height / 2
  const ymax = node.center.y + node.height / 2

  // Group port points by connectionName
  const connectionPointsMap = new Map<
    string,
    Array<{ x: number; y: number; z: number }>
  >()

  for (const pp of node.portPoints) {
    const points = connectionPointsMap.get(pp.connectionName) ?? []
    // Avoid duplicate points
    if (!points.some((p) => p.x === pp.x && p.y === pp.y && p.z === pp.z)) {
      points.push({ x: pp.x, y: pp.y, z: pp.z })
    }
    connectionPointsMap.set(pp.connectionName, points)
  }

  // Separate same-layer pairs from transition pairs
  const sameLayerPairsByZ = new Map<number, Array<[number, number]>>()
  const transitionPairs: Array<[number, number]> = []
  let numEntryExitLayerChanges = 0

  for (const [connectionName, points] of connectionPointsMap) {
    if (points.length < 2) continue

    // Get the two endpoints for this connection
    const p1 = points[0]
    const p2 = points[1]

    // Map to perimeter coordinates
    const t1 = perimeterT(p1, xmin, xmax, ymin, ymax)
    const t2 = perimeterT(p2, xmin, xmax, ymin, ymax)

    if (p1.z === p2.z) {
      // Same layer - add to the layer's chord list
      const z = p1.z
      const chords = sameLayerPairsByZ.get(z) ?? []
      chords.push([t1, t2])
      sameLayerPairsByZ.set(z, chords)
    } else {
      // Transition pair - different layers
      numEntryExitLayerChanges++
      transitionPairs.push([t1, t2])
    }
  }

  // Count same-layer crossings (per layer, then sum)
  let numSameLayerCrossings = 0
  for (const [z, chords] of sameLayerPairsByZ) {
    numSameLayerCrossings += countChordCrossings(chords)
  }

  // Count transition pair crossings
  // Transition pairs can cross each other regardless of layer
  const numTransitionPairCrossings = countChordCrossings(transitionPairs)

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionPairCrossings,
  }
}
