/**
 * Standalone benchmark for CorridorCollisionIndex (Stage 1 AABB fast-rejection +
 * Stage 2 segment-to-segment endpoint math).
 *
 * Run:  npx tsx tests/custom-corridor-bench.ts
 *
 * Zero dependencies beyond the runtime. The CollisionIndex and geometry helpers
 * are lifted directly from Pipeline5HdCacheHighDensitySolver.ts so the
 * benchmark reflects the exact production code path.
 */

// ---------------------------------------------------------------------------
// Minimal type shims (same shapes as production without any imports)
// ---------------------------------------------------------------------------

interface Point3D {
  x: number
  y: number
  z?: number
}

interface HighDensityIntraNodeRoute {
  connectionName: string
  rootConnectionName?: string
  traceThickness?: number
  viaDiameter?: number
  route?: Point3D[]
  vias?: { x: number; y: number }[]
  jumpers?: any
}

// ---------------------------------------------------------------------------
// CorridorSegment interface (same as production)
// ---------------------------------------------------------------------------

interface CorridorSegment {
  a: { x: number; y: number; z: number }
  b: { x: number; y: number; z: number }
  halfWidth: number
}

// ---------------------------------------------------------------------------
// Point-to-segment distance (identical to production)
// ---------------------------------------------------------------------------

function pointToSegmentDistancePoint(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.sqrt((p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2)
}

// ---------------------------------------------------------------------------
// Segment-to-segment distance (identical to production)
// ---------------------------------------------------------------------------

function segmentToSegmentDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const cdx = d.x - c.x
  const cdy = d.y - c.y
  const acx = a.x - c.x
  const acy = a.y - c.y

  const denom = abx * cdy - aby * cdx

  if (Math.abs(denom) < 1e-12) {
    return Math.min(
      pointToSegmentDistancePoint(c, a, b),
      pointToSegmentDistancePoint(d, a, b),
      pointToSegmentDistancePoint(a, c, d),
      pointToSegmentDistancePoint(b, c, d),
    )
  }

  const distToSeg = (p: any, s1: any, s2: any) =>
    pointToSegmentDistancePoint(p, s1, s2)
  return Math.min(
    distToSeg(c, a, b),
    distToSeg(d, a, b),
    distToSeg(a, c, d),
    distToSeg(b, c, d),
  )
}

// ---------------------------------------------------------------------------
// CorridorCollisionIndex (identical to production)
// ---------------------------------------------------------------------------

class CorridorCollisionIndex {
  private segmentsByZ = new Map<number, CorridorSegment[]>()
  private readonly globalMinClearance: number

  constructor(globalMinClearance: number) {
    this.globalMinClearance = globalMinClearance
  }

  get routeCount(): number {
    let count = 0
    for (const segments of this.segmentsByZ.values()) {
      count += segments.length
    }
    return count
  }

  addRoute(route: HighDensityIntraNodeRoute): void {
    const thickness = route.traceThickness ?? 0.15
    const halfWidth = thickness / 2 + this.globalMinClearance
    const resolvedRoute = route.route ?? []
    if (resolvedRoute.length < 2) return

    for (let i = 0; i < resolvedRoute.length - 1; i++) {
      const a = resolvedRoute[i]!
      const b = resolvedRoute[i + 1]!
      const layerZA = a.z ?? 0
      const layerZB = b.z ?? 0

      const addSegmentToLayer = (z: number, seg: any) => {
        let layer = this.segmentsByZ.get(z)
        if (!layer) {
          layer = []
          this.segmentsByZ.set(z, layer)
        }
        layer.push(seg)
      }

      const segment = { a, b, halfWidth }
      addSegmentToLayer(layerZA, segment)
      if (layerZA !== layerZB) {
        addSegmentToLayer(layerZB, segment)
      }
    }
  }

  checkCollision(candidate: HighDensityIntraNodeRoute): number {
    const thickness = candidate.traceThickness ?? 0.15
    const halfWidth = thickness / 2 + this.globalMinClearance
    const resolvedRoute = candidate.route ?? []

    for (let i = 0; i < resolvedRoute.length - 1; i++) {
      const a = resolvedRoute[i]!
      const b = resolvedRoute[i + 1]!
      const z = a.z ?? b.z ?? 0
      const layer = this.segmentsByZ.get(z)
      if (!layer || layer.length === 0) continue

      for (const existing of layer) {
        // Stage 1: AABB bounding-box fast rejection
        const minAx = Math.min(a.x, b.x)
        const maxAx = Math.max(a.x, b.x)
        const minAy = Math.min(a.y, b.y)
        const maxAy = Math.max(a.y, b.y)
        const minBx = Math.min(existing.a.x, existing.b.x)
        const maxBx = Math.max(existing.a.x, existing.b.x)
        const minBy = Math.min(existing.a.y, existing.b.y)
        const maxBy = Math.max(existing.a.y, existing.b.y)

        const minRequiredClearance = halfWidth + existing.halfWidth

        if (
          maxAx + minRequiredClearance < minBx ||
          maxBx + minRequiredClearance < minAx ||
          maxAy + minRequiredClearance < minBy ||
          maxBy + minRequiredClearance < minAy
        ) {
          continue
        }

        // Stage 2: pixel-perfect segment-to-segment distance
        const segDist = segmentToSegmentDistance(a, b, existing.a, existing.b)
        if (segDist < minRequiredClearance) {
          return minRequiredClearance - segDist
        }
      }
    }

    return 0
  }

  clear(): void {
    this.segmentsByZ.clear()
  }
}

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------

const MIN_CLEARANCE = 0.15
const INDEX_SIZE = 1000
const Q = 5000

function makeRoute(coords: [number, number, number][]): HighDensityIntraNodeRoute {
  return {
    connectionName: "bench",
    traceThickness: 0.15,
    route: coords.map(([x, y, z]) => ({ x, y, z })),
  }
}

function makeQueryRoute(
  a: { x: number; y: number },
  b: { x: number; y: number },
  z = 0,
): HighDensityIntraNodeRoute {
  return {
    connectionName: "query",
    traceThickness: 0.15,
    route: [
      { x: a.x, y: a.y, z },
      { x: b.x, y: b.y, z },
    ],
  }
}

// ---------------------------------------------------------------------------
// Scenario A: High-Density Discard (Stage-1 AABB fast-rejection only)
// Query points are placed in a completely non-overlapping region so every
// query segment passes Stage 1 AABB rejection instantly — Stage 2 never runs.
// ---------------------------------------------------------------------------

function runScenarioA(): { totalUs: number; perOpUs: number } {
  const index = new CorridorCollisionIndex(MIN_CLEARANCE)

  // Register INDEX_SIZE segments in region [0, 2000] x [0, 2000]
  for (let i = 0; i < INDEX_SIZE; i++) {
    const ax = (i % 40) * 50
    const ay = Math.floor(i / 40) * 50
    const route = makeRoute([
      [ax, ay, 0],
      [ax + 30, ay + 20, 0],
    ])
    index.addRoute(route)
  }

  // Query from a region offset by +10000 — guaranteed zero overlap
  const queryRoutes: HighDensityIntraNodeRoute[] = []
  for (let i = 0; i < Q; i++) {
    const ax = 10000 + Math.random() * 2000
    const ay = 10000 + Math.random() * 2000
    queryRoutes.push(
      makeQueryRoute({ x: ax, y: ay }, { x: ax + 10, y: ay + 10 }),
    )
  }

  const t0 = performance.now()
  let totalCollisions = 0
  for (const q of queryRoutes) {
    totalCollisions += index.checkCollision(q) > 0 ? 1 : 0
  }
  const t1 = performance.now()

  const totalMs = t1 - t0
  const totalUs = totalMs * 1000
  const perOpUs = totalUs / Q

  console.log(
    `  Scenario A (Stage-1 AABB fast-rejection only, ${index.routeCount} registered, ${Q} queries):`,
  )
  console.log(`    Total time:     ${totalMs.toFixed(2)} ms`)
  console.log(`    Per-operation:  ${perOpUs.toFixed(2)} µs`)
  console.log(`    Collisions:     ${totalCollisions} ${totalCollisions === 0 ? "✓" : "✗ UNEXPECTED"}`)

  return { totalUs, perOpUs }
}

// ---------------------------------------------------------------------------
// Scenario B: Worst-Case Intersection (Stage-2 pixel-perfect math on every hit)
// Every query segment exactly overlaps a registered segment, forcing both
// Stage 1 AABB test to pass AND Stage 2 segment-to-segment distance computation.
// ---------------------------------------------------------------------------

function runScenarioB(): { totalUs: number; perOpUs: number } {
  const index = new CorridorCollisionIndex(MIN_CLEARANCE)

  // Same INDEX_SIZE segments layout
  const registered: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
  for (let i = 0; i < INDEX_SIZE; i++) {
    const ax = (i % 40) * 50
    const ay = Math.floor(i / 40) * 50
    const bx = ax + 30
    const by = ay + 20
    const route = makeRoute([
      [ax, ay, 0],
      [bx, by, 0],
    ])
    index.addRoute(route)
    registered.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } })
  }

  // Query segments that exactly match — worst-case overlaps
  const queryRoutes: HighDensityIntraNodeRoute[] = []
  for (let i = 0; i < Q; i++) {
    const seg = registered[i % registered.length]!
    queryRoutes.push(makeQueryRoute(seg.a, seg.b))
  }

  const t0 = performance.now()
  let totalCollisions = 0
  for (const q of queryRoutes) {
    totalCollisions += index.checkCollision(q) > 0 ? 1 : 0
  }
  const t1 = performance.now()

  const totalMs = t1 - t0
  const totalUs = totalMs * 1000
  const perOpUs = totalUs / Q

  console.log(
    `  Scenario B (Stage-2 pixel-perfect intersection, ${index.routeCount} registered, ${Q} queries):`,
  )
  console.log(`    Total time:     ${totalMs.toFixed(2)} ms`)
  console.log(`    Per-operation:  ${perOpUs.toFixed(2)} µs`)
  console.log(`    Collisions:     ${totalCollisions} ${totalCollisions === Q ? "✓" : "✗ EXPECTED " + Q}`)

  return { totalUs, perOpUs }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=".repeat(68))
console.log("  CorridorCollisionIndex — Production Code Path Benchmark")
console.log("  Stage 1: AABB fast-rejection | Stage 2: segment-to-segment math")
console.log("=".repeat(68))
console.log()

const resultA = runScenarioA()
console.log()
const resultB = runScenarioB()
console.log()
console.log("=".repeat(68))
console.log("  FINAL SUMMARY")
console.log("=".repeat(68))
console.log(
  `  Scenario A (fast-reject):  ${resultA.perOpUs.toFixed(2)} µs/op  (${resultA.totalUs.toFixed(0)} µs total for ${Q} ops)`,
)
console.log(
  `  Scenario B (worst-case):   ${resultB.perOpUs.toFixed(2)} µs/op  (${resultB.totalUs.toFixed(0)} µs total for ${Q} ops)`,
)
console.log(
  `  Stage-1→Stage-2 ratio:    ${(resultB.perOpUs / Math.max(resultA.perOpUs, 0.001)).toFixed(1)}x slower in worst-case`,
)
console.log()