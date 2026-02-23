import type { CapacityMeshNodeId } from "lib/types"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { isPortTouchingObstacle } from "./is-port-touching-obstacle"
import { runDepth2BfsWithSelectedCrammed } from "../bfs/run-depth2-bfs-with-selected-crammed"

/** Tries progressively adding crammed ports to unblock degree-2 choke. */
export const tryResolveChokeWithCrammedPortsForCurrentObstacle = (
  solver: PortPointReachability2HopCheckSolver,
): boolean => {
  const candidateCrammedPortPoints = new Map<
    string,
    SharedEdgeSegment["crammedPortPoints"][number]
  >()
  const degree1Nodes = new Set<CapacityMeshNodeId>()

  for (const [nodeId, depth] of solver.currentDiscoveredDepthByNodeId) {
    if (depth === 1) {
      degree1Nodes.add(nodeId)
    }
  }

  for (const [
    edgeKey,
    crammedPortPoints,
  ] of solver.crammedPortPointsByEdgeKey) {
    const [nodeIdA, nodeIdB] = edgeKey.split("__")
    if (!degree1Nodes.has(nodeIdA) && !degree1Nodes.has(nodeIdB)) continue

    for (const pp of crammedPortPoints) {
      candidateCrammedPortPoints.set(pp.segmentPortPointId, pp)
    }
  }

  if (candidateCrammedPortPoints.size === 0) return false

  const orderedCandidates = [...candidateCrammedPortPoints.values()].sort(
    (a, b) => {
      const aTouching = isPortTouchingObstacle({
        solver,
        portId: a.segmentPortPointId,
      })
      const bTouching = isPortTouchingObstacle({
        solver,
        portId: b.segmentPortPointId,
      })
      if (aTouching !== bTouching) return aTouching ? 1 : -1
      return (a.distToCentermostPortOnZ ?? 0) - (b.distToCentermostPortOnZ ?? 0)
    },
  )

  const selectedCrammedPortPointIds = new Set<string>()
  for (const candidate of orderedCandidates) {
    selectedCrammedPortPointIds.add(candidate.segmentPortPointId)
    const rerun = runDepth2BfsWithSelectedCrammed({
      solver,
      selectedCrammedPortPointIds,
    })

    if (!rerun.chokeBlockedAtDegree2) {
      solver.currentDiscoveredDepthByNodeId = rerun.discoveredDepthByNodeId
      solver.currentDiscoveredDepthByEdgeKey = rerun.discoveredDepthByEdgeKey
      solver.discoveredPortIdsByDegree = rerun.discoveredPortIdsByDegree
      solver.currentChokeBlockedAtDegree2 = false
      solver.currentUsedCrammedPortPointIds = new Set(
        selectedCrammedPortPointIds,
      )
      for (const portPointId of selectedCrammedPortPointIds) {
        solver.usedCrammedPortPointIds.add(portPointId)
      }
      solver.activeObstacleUsesCrammed = true
      return true
    }
  }

  return false
}
