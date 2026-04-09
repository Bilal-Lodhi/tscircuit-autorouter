import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { distance, type Point3D } from "./geometry"

const RELAXED_CLEARANCE = 0.1
const DEFAULT_LOCAL_RADIUS = 0.75

export type LocalIssueCandidateScore = {
  obstacleCollisionCount: number
  routeCollisionCount: number
  issueDistanceScore: number
  routeLengthPenalty: number
}

const getRouteRootId = (route: HighDensityRoute) =>
  route.rootConnectionName ?? route.connectionName

const areRoutesConnected = (
  a: HighDensityRoute,
  b: HighDensityRoute,
  connMap?: ConnectivityMap | null,
) => {
  const aId = getRouteRootId(a)
  const bId = getRouteRootId(b)
  return aId === bId || Boolean(connMap?.areIdsConnected?.(aId, bId))
}

const isObstacleOnLayer = (
  obstacle: Obstacle,
  z: number,
  layerCount: number,
) => {
  if (obstacle.zLayers?.length) {
    return obstacle.zLayers.includes(z)
  }

  const layerName = mapZToLayerName(z, layerCount)
  return obstacle.layers.includes(layerName)
}

const isObstacleConnectedToRoute = (
  obstacle: Obstacle,
  route: HighDensityRoute,
  connMap?: ConnectivityMap | null,
) => {
  const rootId = getRouteRootId(route)
  return obstacle.connectedTo.some(
    (id) => id === route.connectionName || id === rootId || connMap?.areIdsConnected?.(rootId, id),
  )
}

const getSegmentSamplePoints = (start: Point3D, end: Point3D) => [
  start,
  {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    z: start.z,
  },
  end,
]

const getLocalSegments = (
  route: HighDensityRoute,
  issueCenter: { x: number; y: number },
  radius: number,
) =>
  route.route
    .slice(0, -1)
    .map((start, segmentIndex) => {
      const end = route.route[segmentIndex + 1]
      const midpoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      }
      return {
        start,
        end,
        segmentIndex,
        distanceToIssue: distance(midpoint, issueCenter),
      }
    })
    .filter(
      (segment) =>
        segment.start.z === segment.end.z &&
        segment.distanceToIssue <= radius + route.traceThickness,
    )

export const createLocalIssueCandidateScore = (params: {
  issueCenter: { x: number; y: number }
  candidateRoute: HighDensityRoute
  originalRoute: HighDensityRoute
  currentRouteSpatialIndex: HighDensityRouteSpatialIndex
  obstacleSHI: ObstacleSpatialHashIndex
  simpleRouteJson: SimpleRouteJson
  connMap?: ConnectivityMap | null
}) => {
  const {
    issueCenter,
    candidateRoute,
    originalRoute,
    currentRouteSpatialIndex,
    obstacleSHI,
    simpleRouteJson,
    connMap,
  } = params
  const localSegments = getLocalSegments(
    candidateRoute,
    issueCenter,
    DEFAULT_LOCAL_RADIUS,
  )
  let obstacleCollisionCount = 0
  let routeCollisionCount = 0
  let issueDistanceScore = Number.POSITIVE_INFINITY
  const seenObstacleKeys = new Set<string>()
  const seenRouteKeys = new Set<string>()
  const searchRadius = RELAXED_CLEARANCE + candidateRoute.traceThickness / 2

  for (const segment of localSegments) {
    const minX =
      Math.min(segment.start.x, segment.end.x) - searchRadius - 0.05
    const minY =
      Math.min(segment.start.y, segment.end.y) - searchRadius - 0.05
    const maxX =
      Math.max(segment.start.x, segment.end.x) + searchRadius + 0.05
    const maxY =
      Math.max(segment.start.y, segment.end.y) + searchRadius + 0.05

    issueDistanceScore = Math.min(issueDistanceScore, segment.distanceToIssue)

    for (const obstacle of obstacleSHI.search({ minX, minY, maxX, maxY })) {
      if (
        !isObstacleOnLayer(obstacle, segment.start.z, simpleRouteJson.layerCount)
      ) {
        continue
      }
      if (isObstacleConnectedToRoute(obstacle, candidateRoute, connMap)) {
        continue
      }
      const distanceToObstacle = segmentToBoxMinDistance(
        segment.start,
        segment.end,
        obstacle,
      )
      if (distanceToObstacle >= searchRadius) {
        continue
      }
      const obstacleKey =
        obstacle.obstacleId ??
        `${obstacle.center.x}:${obstacle.center.y}:${segment.start.z}`
      if (seenObstacleKeys.has(obstacleKey)) continue
      seenObstacleKeys.add(obstacleKey)
      obstacleCollisionCount += 1
    }

    for (const samplePoint of getSegmentSamplePoints(segment.start, segment.end)) {
      const nearbyRoutes = currentRouteSpatialIndex.getConflictingRoutesNearPoint(
        samplePoint,
        searchRadius,
      )

      for (const { conflictingRoute } of nearbyRoutes) {
        if (conflictingRoute === originalRoute) continue
        if (areRoutesConnected(candidateRoute, conflictingRoute, connMap)) {
          continue
        }
        const routeKey = `${conflictingRoute.connectionName}:${samplePoint.z}`
        if (seenRouteKeys.has(routeKey)) continue
        seenRouteKeys.add(routeKey)
        routeCollisionCount += 1
      }
    }
  }

  if (!Number.isFinite(issueDistanceScore)) {
    issueDistanceScore = Number.POSITIVE_INFINITY
  }

  const routeLengthPenalty = candidateRoute.route.length

  return {
    obstacleCollisionCount,
    routeCollisionCount,
    issueDistanceScore,
    routeLengthPenalty,
  } satisfies LocalIssueCandidateScore
}

export const isBetterLocalIssueCandidateScore = (
  candidate: LocalIssueCandidateScore,
  baseline: LocalIssueCandidateScore,
) => {
  const candidateCollisions =
    candidate.obstacleCollisionCount + candidate.routeCollisionCount
  const baselineCollisions =
    baseline.obstacleCollisionCount + baseline.routeCollisionCount

  if (candidateCollisions !== baselineCollisions) {
    return candidateCollisions < baselineCollisions
  }

  if (candidate.obstacleCollisionCount !== baseline.obstacleCollisionCount) {
    return candidate.obstacleCollisionCount < baseline.obstacleCollisionCount
  }

  if (candidate.routeCollisionCount !== baseline.routeCollisionCount) {
    return candidate.routeCollisionCount < baseline.routeCollisionCount
  }

  if (candidate.issueDistanceScore !== baseline.issueDistanceScore) {
    return candidate.issueDistanceScore > baseline.issueDistanceScore
  }

  return candidate.routeLengthPenalty < baseline.routeLengthPenalty
}
