import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

/**
 * Precomputed intersection data for fast intra-node crossing detection.
 * Uses bitset adjacency matrices to avoid geometry calculations at runtime.
 */
export interface IntraNodeCrossingPrecompute {
  P: number
  zByPort: Int16Array

  // Same-layer segment universe (endpoints share z)
  samePairToSeg: Int32Array // size P*P, -1 if not a valid same-layer pair
  sameAdj: Uint32Array // flattened [segId * sameW + word]
  sameSegCount: number
  sameW: number

  // Transition segment universe (endpoints differ in z)
  transPairToSeg: Int32Array
  transAdj: Uint32Array
  transSegCount: number
  transW: number

  // Scratch arrays (reused each call to avoid GC)
  activeSameMask: Uint32Array
  activeTransMask: Uint32Array
  activeSameSegIds: Int32Array
  activeTransSegIds: Int32Array
}

export type PortPointAssignment = Array<[portPointIndex: number, netId: number]>

export type NodeWithCrossingPrecompute = InputNodeWithPortPoints & {
  _intraNodeCrossingPre?: IntraNodeCrossingPrecompute
}

// Match accuracy scale from legacy getIntraNodeCrossings
const SCALE = 10_000
const intSpace = (a: number) => Math.round(a * SCALE)

function popcnt32(v: number): number {
  v >>>= 0
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function setAdjBit(adj: Uint32Array, W: number, row: number, col: number): void {
  adj[row * W + (col >>> 5)] |= 1 << (col & 31)
}

function hasAdjBit(adj: Uint32Array, W: number, row: number, col: number): boolean {
  return (adj[row * W + (col >>> 5)] & (1 << (col & 31))) !== 0
}

// Robust inclusive segment intersection in 2D (counts touch + overlap)
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  return v === 0 ? 0 : v > 0 ? 1 : -1
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return (
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    py >= Math.min(ay, by) &&
    py <= Math.max(ay, by)
  )
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy)
  const o2 = orient(ax, ay, bx, by, dx, dy)
  const o3 = orient(cx, cy, dx, dy, ax, ay)
  const o4 = orient(cx, cy, dx, dy, bx, by)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true
  return false
}

/**
 * Precompute segment intersection data for a node.
 * This builds bitset adjacency matrices for same-layer and transition segments.
 */
export function preprocessIntraNodeCrossings(node: NodeWithCrossingPrecompute): void {
  const P = node.portPoints.length
  if (P < 2) {
    node._intraNodeCrossingPre = {
      P,
      zByPort: new Int16Array(P),
      samePairToSeg: new Int32Array(P * P).fill(-1),
      sameAdj: new Uint32Array(0),
      sameSegCount: 0,
      sameW: 0,
      transPairToSeg: new Int32Array(P * P).fill(-1),
      transAdj: new Uint32Array(0),
      transSegCount: 0,
      transW: 0,
      activeSameMask: new Uint32Array(0),
      activeTransMask: new Uint32Array(0),
      activeSameSegIds: new Int32Array(P),
      activeTransSegIds: new Int32Array(P),
    }
    return
  }

  // Integer coords & z
  const xs = new Int32Array(P)
  const ys = new Int32Array(P)
  const zs = new Int16Array(P)
  for (let i = 0; i < P; i++) {
    const pp = node.portPoints[i]
    xs[i] = intSpace(pp.x)
    ys[i] = intSpace(pp.y)
    zs[i] = pp.z as number
  }

  // Count how many possible segments in each universe
  let sameCount = 0
  let transCount = 0
  for (let i = 0; i < P; i++) {
    for (let j = i + 1; j < P; j++) {
      if (zs[i] === zs[j]) sameCount++
      else transCount++
    }
  }

  const samePairToSeg = new Int32Array(P * P)
  const transPairToSeg = new Int32Array(P * P)
  samePairToSeg.fill(-1)
  transPairToSeg.fill(-1)

  // Endpoints for precompute (locals only; not stored after)
  const sameA = new Int16Array(sameCount)
  const sameB = new Int16Array(sameCount)
  const sameZ = new Int16Array(sameCount)

  const transA = new Int16Array(transCount)
  const transB = new Int16Array(transCount)

  // Enumerate segments and fill pair->segId lookup
  let s = 0
  let t = 0
  for (let i = 0; i < P; i++) {
    for (let j = i + 1; j < P; j++) {
      const ij = i * P + j
      const ji = j * P + i
      if (zs[i] === zs[j]) {
        sameA[s] = i
        sameB[s] = j
        sameZ[s] = zs[i]
        samePairToSeg[ij] = s
        samePairToSeg[ji] = s
        s++
      } else {
        transA[t] = i
        transB[t] = j
        transPairToSeg[ij] = t
        transPairToSeg[ji] = t
        t++
      }
    }
  }

  const sameW = (sameCount + 31) >>> 5
  const transW = (transCount + 31) >>> 5
  const sameAdj = new Uint32Array(sameCount * sameW)
  const transAdj = new Uint32Array(transCount * transW)

  // Build same-layer adjacency: only compare segments on the same z
  for (let i = 0; i < sameCount; i++) {
    const a1 = sameA[i],
      b1 = sameB[i]
    const ax1 = xs[a1],
      ay1 = ys[a1]
    const bx1 = xs[b1],
      by1 = ys[b1]
    const z1 = sameZ[i]

    for (let j = i + 1; j < sameCount; j++) {
      if (sameZ[j] !== z1) continue

      const a2 = sameA[j],
        b2 = sameB[j]
      if (segmentsIntersect(ax1, ay1, bx1, by1, xs[a2], ys[a2], xs[b2], ys[b2])) {
        setAdjBit(sameAdj, sameW, i, j)
        setAdjBit(sameAdj, sameW, j, i)
      }
    }
  }

  // Build transition adjacency: compare all transition segments
  for (let i = 0; i < transCount; i++) {
    const a1 = transA[i],
      b1 = transB[i]
    const ax1 = xs[a1],
      ay1 = ys[a1]
    const bx1 = xs[b1],
      by1 = ys[b1]

    for (let j = i + 1; j < transCount; j++) {
      const a2 = transA[j],
        b2 = transB[j]
      if (segmentsIntersect(ax1, ay1, bx1, by1, xs[a2], ys[a2], xs[b2], ys[b2])) {
        setAdjBit(transAdj, transW, i, j)
        setAdjBit(transAdj, transW, j, i)
      }
    }
  }

  node._intraNodeCrossingPre = {
    P,
    zByPort: zs,

    samePairToSeg,
    sameAdj,
    sameSegCount: sameCount,
    sameW,

    transPairToSeg,
    transAdj,
    transSegCount: transCount,
    transW,

    // scratch sized for worst case active segment count <= floor(P/2)
    activeSameMask: new Uint32Array(sameW),
    activeTransMask: new Uint32Array(transW),
    activeSameSegIds: new Int32Array(P),
    activeTransSegIds: new Int32Array(P),
  }
}

function countFromBitsets(
  adj: Uint32Array,
  W: number,
  activeMask: Uint32Array,
  activeSegIds: Int32Array,
  activeCount: number
): number {
  let total = 0
  for (let i = 0; i < activeCount; i++) {
    const segId = activeSegIds[i]
    const row = segId * W
    for (let w = 0; w < W; w++) {
      total += popcnt32(adj[row + w] & activeMask[w])
    }
  }
  // Each intersection is counted twice (A sees B, B sees A)
  return total >>> 1
}

/**
 * Fast crossing detection using precomputed bitset adjacency matrices.
 * For use with portPointAssignment arrays where each entry is [portPointIndex, netId].
 */
export function getIntraNodeCrossingsFast(
  node: NodeWithCrossingPrecompute,
  portPointAssignment: PortPointAssignment
): {
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionPairCrossings: number
} {
  if (!node._intraNodeCrossingPre) {
    preprocessIntraNodeCrossings(node)
  }
  const pre = node._intraNodeCrossingPre!

  const {
    P,
    zByPort,
    samePairToSeg,
    sameAdj,
    sameW,
    transPairToSeg,
    transAdj,
    transW,
    activeSameMask,
    activeTransMask,
    activeSameSegIds,
    activeTransSegIds,
  } = pre

  // Clear active masks
  activeSameMask.fill(0)
  activeTransMask.fill(0)

  let sameActiveCount = 0
  let transActiveCount = 0

  // Pair ports per net in a single streaming pass: each time we see net twice, we form a segment.
  const firstPortByNet = new Map<number, number>()

  // Only allocated/used if a net generates >1 segment in the same category,
  // so we can subtract same-net intersections.
  let multiSame: Map<number, number[]> | undefined
  let firstSameSegByNet: Map<number, number> | undefined

  let multiTrans: Map<number, number[]> | undefined
  let firstTransSegByNet: Map<number, number> | undefined

  for (let k = 0; k < portPointAssignment.length; k++) {
    const pp = portPointAssignment[k][0]
    const net = portPointAssignment[k][1]
    if (net < 0) continue

    const first = firstPortByNet.get(net)
    if (first === undefined) {
      firstPortByNet.set(net, pp)
      continue
    }
    firstPortByNet.delete(net)

    const i = first
    const j = pp

    if (zByPort[i] === zByPort[j]) {
      const segId = samePairToSeg[i * P + j]
      if (segId >= 0) {
        const word = segId >>> 5
        const bit = 1 << (segId & 31)

        if ((activeSameMask[word] & bit) === 0) {
          activeSameMask[word] |= bit
          activeSameSegIds[sameActiveCount++] = segId

          // Track same-net multi segments (only if needed)
          if (firstSameSegByNet === undefined) firstSameSegByNet = new Map()
          const prevSeg = firstSameSegByNet.get(net)
          if (prevSeg === undefined) {
            firstSameSegByNet.set(net, segId)
          } else {
            if (multiSame === undefined) multiSame = new Map()
            let list = multiSame.get(net)
            if (!list) {
              list = [prevSeg, segId]
              multiSame.set(net, list)
            } else {
              list.push(segId)
            }
          }
        }
      }
    } else {
      const segId = transPairToSeg[i * P + j]
      if (segId >= 0) {
        const word = segId >>> 5
        const bit = 1 << (segId & 31)

        if ((activeTransMask[word] & bit) === 0) {
          activeTransMask[word] |= bit
          activeTransSegIds[transActiveCount++] = segId

          if (firstTransSegByNet === undefined) firstTransSegByNet = new Map()
          const prevSeg = firstTransSegByNet.get(net)
          if (prevSeg === undefined) {
            firstTransSegByNet.set(net, segId)
          } else {
            if (multiTrans === undefined) multiTrans = new Map()
            let list = multiTrans.get(net)
            if (!list) {
              list = [prevSeg, segId]
              multiTrans.set(net, list)
            } else {
              list.push(segId)
            }
          }
        }
      }
    }
  }

  let numSameLayerCrossings = countFromBitsets(
    sameAdj,
    sameW,
    activeSameMask,
    activeSameSegIds,
    sameActiveCount
  )

  let numTransitionPairCrossings = countFromBitsets(
    transAdj,
    transW,
    activeTransMask,
    activeTransSegIds,
    transActiveCount
  )

  // Subtract same-net intersections if a net produced multiple segments.
  if (multiSame) {
    let sameNetHits = 0
    for (const segs of multiSame.values()) {
      for (let a = 0; a < segs.length; a++) {
        const sa = segs[a]
        for (let b = a + 1; b < segs.length; b++) {
          const sb = segs[b]
          if (hasAdjBit(sameAdj, sameW, sa, sb)) sameNetHits++
        }
      }
    }
    numSameLayerCrossings -= sameNetHits
  }

  if (multiTrans) {
    let sameNetHits = 0
    for (const segs of multiTrans.values()) {
      for (let a = 0; a < segs.length; a++) {
        const sa = segs[a]
        for (let b = a + 1; b < segs.length; b++) {
          const sb = segs[b]
          if (hasAdjBit(transAdj, transW, sa, sb)) sameNetHits++
        }
      }
    }
    numTransitionPairCrossings -= sameNetHits
  }

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges: transActiveCount,
    numTransitionPairCrossings,
  }
}

/**
 * Check if any same-layer crossing exists (early exit for SINGLE_LAYER_MODE).
 * Returns true if at least one intersection is detected.
 */
export function hasAnySameLayerCrossing(
  node: NodeWithCrossingPrecompute,
  portPointAssignment: PortPointAssignment
): boolean {
  if (!node._intraNodeCrossingPre) {
    preprocessIntraNodeCrossings(node)
  }
  const pre = node._intraNodeCrossingPre!

  const { P, zByPort, samePairToSeg, sameAdj, sameW } = pre

  // Collect active same-layer segments
  const activeSegIds: number[] = []
  const activeMask = new Uint32Array(sameW)

  const firstPortByNet = new Map<number, number>()

  for (let k = 0; k < portPointAssignment.length; k++) {
    const pp = portPointAssignment[k][0]
    const net = portPointAssignment[k][1]
    if (net < 0) continue

    const first = firstPortByNet.get(net)
    if (first === undefined) {
      firstPortByNet.set(net, pp)
      continue
    }
    firstPortByNet.delete(net)

    const i = first
    const j = pp

    if (zByPort[i] === zByPort[j]) {
      const segId = samePairToSeg[i * P + j]
      if (segId >= 0) {
        const word = segId >>> 5
        const bit = 1 << (segId & 31)

        if ((activeMask[word] & bit) === 0) {
          activeMask[word] |= bit

          // Check if this new segment intersects any already-active segment
          const row = segId * sameW
          for (let w = 0; w < sameW; w++) {
            if ((sameAdj[row + w] & activeMask[w]) !== 0) {
              return true // Found an intersection, exit early
            }
          }

          activeSegIds.push(segId)
        }
      }
    }
  }

  return false
}

/**
 * Version of getIntraNodeCrossings that works with PortPoint arrays (connectionName-based).
 * This is a drop-in replacement for the legacy getIntraNodeCrossings when used with
 * InputNodeWithPortPoints that have been preprocessed.
 */
export function getIntraNodeCrossingsFastFromPortPoints(
  node: NodeWithCrossingPrecompute,
  portPoints: PortPoint[]
): {
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionPairCrossings: number
} {
  if (!node._intraNodeCrossingPre) {
    preprocessIntraNodeCrossings(node)
  }

  // Build a portPointAssignment from connectionNames
  // First, map each port point to its index in node.portPoints
  const nodePortPoints = node.portPoints
  const portPointToIndex = new Map<string, number>()
  for (let i = 0; i < nodePortPoints.length; i++) {
    const pp = nodePortPoints[i]
    const key = `${pp.x.toFixed(5)},${pp.y.toFixed(5)},${pp.z}`
    portPointToIndex.set(key, i)
  }

  // Map connectionNames to netIds
  const connectionNameToNetId = new Map<string, number>()
  let nextNetId = 0

  const assignment: PortPointAssignment = []

  for (const pp of portPoints) {
    const key = `${pp.x.toFixed(5)},${pp.y.toFixed(5)},${pp.z}`
    const portIdx = portPointToIndex.get(key)
    if (portIdx === undefined) continue

    let netId = connectionNameToNetId.get(pp.connectionName)
    if (netId === undefined) {
      netId = nextNetId++
      connectionNameToNetId.set(pp.connectionName, netId)
    }

    assignment.push([portIdx, netId])
  }

  return getIntraNodeCrossingsFast(node, assignment)
}

/**
 * Check if any crossing exists in SINGLE_LAYER_MODE (early exit).
 * Works with PortPoint arrays.
 */
export function hasAnyCrossingFromPortPoints(
  node: NodeWithCrossingPrecompute,
  portPoints: PortPoint[]
): boolean {
  if (!node._intraNodeCrossingPre) {
    preprocessIntraNodeCrossings(node)
  }

  const nodePortPoints = node.portPoints
  const portPointToIndex = new Map<string, number>()
  for (let i = 0; i < nodePortPoints.length; i++) {
    const pp = nodePortPoints[i]
    const key = `${pp.x.toFixed(5)},${pp.y.toFixed(5)},${pp.z}`
    portPointToIndex.set(key, i)
  }

  const connectionNameToNetId = new Map<string, number>()
  let nextNetId = 0

  const assignment: PortPointAssignment = []

  for (const pp of portPoints) {
    const key = `${pp.x.toFixed(5)},${pp.y.toFixed(5)},${pp.z}`
    const portIdx = portPointToIndex.get(key)
    if (portIdx === undefined) continue

    let netId = connectionNameToNetId.get(pp.connectionName)
    if (netId === undefined) {
      netId = nextNetId++
      connectionNameToNetId.set(pp.connectionName, netId)
    }

    assignment.push([portIdx, netId])
  }

  return hasAnySameLayerCrossing(node, assignment)
}
