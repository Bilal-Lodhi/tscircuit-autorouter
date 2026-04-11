import { distance, pointToBoxDistance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type ConnectionPoint,
  type Obstacle,
  type SimpleRouteConnection,
  type SimpleRouteJson,
  isSingleLayerConnectionPoint,
} from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInRect } from "lib/utils/isPointInRect"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../BaseSolver"
import { obstacleToSegments } from "../TraceKeepoutSolver/obstacleToSegments"

const ESCAPE_POINT_ID_PREFIX = "escape-via:"
const GEOMETRIC_TOLERANCE = 1e-4

type Point2D = {
  x: number
  y: number
}

export interface EscapeViaMetadata {
  pointId: string
  x: number
  y: number
  connectionName: string
  rootConnectionName: string
  sourcePointIndex: number
  sourcePointId?: string
  sourceLayer: string
  targetLayer: string
  targetPourKey: string
}

interface EscapeViaCandidate extends EscapeViaMetadata {
  score: number
}

export interface EscapeViaLocationSolverOptions {
  viaDiameter?: number
  minTraceWidth?: number
  obstacleMargin?: number
}

const getObstacleKey = (obstacle: Obstacle) =>
  obstacle.obstacleId ??
  [
    obstacle.layers.join("."),
    obstacle.center.x.toFixed(4),
    obstacle.center.y.toFixed(4),
    obstacle.width.toFixed(4),
    obstacle.height.toFixed(4),
  ].join(":")

const pointMatches = (
  a: Point2D,
  b: Point2D,
  tolerance = GEOMETRIC_TOLERANCE,
) => distance(a, b) <= tolerance

export class EscapeViaLocationSolver extends BaseSolver {
  override getSolverName(): string {
    return "EscapeViaLocationSolver"
  }

  viaDiameter: number
  viaRadius: number
  minTraceWidth: number
  obstacleMargin: number
  escapeOffset: number
  requiredTraceClearance: number
  outputSrj: SimpleRouteJson
  escapeViaMetadataByPointId: Map<string, EscapeViaMetadata>
  createdEscapeVias: EscapeViaMetadata[]
  nextEscapeViaIndex = 0

  constructor(
    public readonly ogSrj: SimpleRouteJson,
    opts: EscapeViaLocationSolverOptions = {},
  ) {
    super()
    this.viaDiameter = opts.viaDiameter ?? ogSrj.minViaDiameter ?? 0.3
    this.viaRadius = this.viaDiameter / 2
    this.minTraceWidth = opts.minTraceWidth ?? ogSrj.minTraceWidth
    this.obstacleMargin =
      opts.obstacleMargin ?? ogSrj.defaultObstacleMargin ?? 0.15
    this.escapeOffset =
      this.viaRadius + Math.max(this.minTraceWidth / 2, this.obstacleMargin)
    this.requiredTraceClearance =
      this.minTraceWidth / 2 + this.obstacleMargin / 2
    this.outputSrj = ogSrj
    this.escapeViaMetadataByPointId = new Map()
    this.createdEscapeVias = []
  }

  private getConnectionNetIds(connection: SimpleRouteConnection): Set<string> {
    return new Set(
      [
        connection.name,
        connection.rootConnectionName,
        connection.netConnectionName,
        ...(connection.mergedConnectionNames ?? []),
      ].filter((id): id is string => Boolean(id)),
    )
  }

  private obstacleMatchesConnectionNet(
    obstacle: Obstacle,
    connectionNetIds: Set<string>,
  ): boolean {
    return obstacle.connectedTo.some((id) => connectionNetIds.has(id))
  }

  private getObstacleZs(obstacle: Obstacle): number[] {
    if (obstacle.zLayers && obstacle.zLayers.length > 0) {
      return obstacle.zLayers
    }
    return obstacle.layers.map((layer) =>
      mapLayerNameToZ(layer, this.ogSrj.layerCount),
    )
  }

  private selectSourceObstacle(params: {
    point: ConnectionPoint
    sourceLayer: string
    connectionNetIds: Set<string>
  }): Obstacle | undefined {
    const { point, sourceLayer, connectionNetIds } = params
    return this.ogSrj.obstacles
      .filter(
        (obstacle) =>
          !obstacle.isCopperPour &&
          obstacle.layers.includes(sourceLayer) &&
          isPointInRect(point, obstacle),
      )
      .sort((a, b) => {
        const aDirectHit =
          a.connectedTo.includes(point.pointId ?? "") ||
          a.connectedTo.includes(point.pcb_port_id ?? "") ||
          this.obstacleMatchesConnectionNet(a, connectionNetIds)
        const bDirectHit =
          b.connectedTo.includes(point.pointId ?? "") ||
          b.connectedTo.includes(point.pcb_port_id ?? "") ||
          this.obstacleMatchesConnectionNet(b, connectionNetIds)
        if (aDirectHit !== bDirectHit) {
          return aDirectHit ? -1 : 1
        }
        return a.width * a.height - b.width * b.height
      })[0]
  }

  private getCandidatePositions(
    point: ConnectionPoint,
    sourceObstacle?: Obstacle,
  ): Point2D[] {
    if (!sourceObstacle) {
      return [
        { x: point.x + this.escapeOffset, y: point.y },
        { x: point.x - this.escapeOffset, y: point.y },
        { x: point.x, y: point.y + this.escapeOffset },
        { x: point.x, y: point.y - this.escapeOffset },
        {
          x: point.x + this.escapeOffset,
          y: point.y + this.escapeOffset,
        },
        {
          x: point.x + this.escapeOffset,
          y: point.y - this.escapeOffset,
        },
        {
          x: point.x - this.escapeOffset,
          y: point.y + this.escapeOffset,
        },
        {
          x: point.x - this.escapeOffset,
          y: point.y - this.escapeOffset,
        },
      ]
    }

    const leftX =
      sourceObstacle.center.x - sourceObstacle.width / 2 - this.escapeOffset
    const rightX =
      sourceObstacle.center.x + sourceObstacle.width / 2 + this.escapeOffset
    const bottomY =
      sourceObstacle.center.y - sourceObstacle.height / 2 - this.escapeOffset
    const topY =
      sourceObstacle.center.y + sourceObstacle.height / 2 + this.escapeOffset

    return [
      { x: leftX, y: point.y },
      { x: rightX, y: point.y },
      { x: point.x, y: bottomY },
      { x: point.x, y: topY },
      { x: leftX, y: bottomY },
      { x: leftX, y: topY },
      { x: rightX, y: bottomY },
      { x: rightX, y: topY },
    ]
  }

  private isInsideBoard(candidate: Point2D): boolean {
    return (
      candidate.x >= this.ogSrj.bounds.minX + this.viaRadius &&
      candidate.x <= this.ogSrj.bounds.maxX - this.viaRadius &&
      candidate.y >= this.ogSrj.bounds.minY + this.viaRadius &&
      candidate.y <= this.ogSrj.bounds.maxY - this.viaRadius
    )
  }

  private hasClearEscapePath(params: {
    sourcePoint: ConnectionPoint
    candidate: Point2D
    sourceLayer: string
    sourceObstacle?: Obstacle
  }): boolean {
    const { sourcePoint, candidate, sourceLayer, sourceObstacle } = params
    for (const obstacle of this.ogSrj.obstacles) {
      if (obstacle === sourceObstacle) continue
      if (!obstacle.layers.includes(sourceLayer)) continue

      if (isPointInRect(candidate, obstacle)) {
        return false
      }

      const obstacleSegments = obstacleToSegments(obstacle)
      const minDistance = Math.min(
        ...obstacleSegments.map((segment) =>
          minimumDistanceBetweenSegments(
            sourcePoint,
            candidate,
            segment.start,
            segment.end,
          ),
        ),
      )

      if (minDistance + GEOMETRIC_TOLERANCE < this.requiredTraceClearance) {
        return false
      }
    }

    return true
  }

  private getMinBlockingClearance(params: {
    candidate: Point2D
    connectionNetIds: Set<string>
    sourceZ: number
    targetZ: number
  }): number {
    const { candidate, connectionNetIds, sourceZ, targetZ } = params
    const spanMinZ = Math.min(sourceZ, targetZ)
    const spanMaxZ = Math.max(sourceZ, targetZ)
    let minClearance = Number.POSITIVE_INFINITY

    for (const obstacle of this.ogSrj.obstacles) {
      const obstacleZs = this.getObstacleZs(obstacle)
      if (!obstacleZs.some((z) => z >= spanMinZ && z <= spanMaxZ)) {
        continue
      }

      if (
        obstacle.isCopperPour &&
        !obstacleZs.includes(sourceZ)
      ) {
        continue
      }

      const clearance = pointToBoxDistance(candidate, obstacle) - this.viaRadius
      minClearance = Math.min(minClearance, clearance)

      if (minClearance + GEOMETRIC_TOLERANCE < this.obstacleMargin) {
        return minClearance
      }
    }

    return minClearance
  }

  private findBestEscapeViaCandidate(params: {
    connection: SimpleRouteConnection
    point: ConnectionPoint
    pointIndex: number
    matchingCopperPours: Obstacle[]
    connectionNetIds: Set<string>
  }): EscapeViaCandidate | null {
    const {
      connection,
      point,
      pointIndex,
      matchingCopperPours,
      connectionNetIds,
    } = params

    if (!isSingleLayerConnectionPoint(point)) {
      return null
    }

    const sourceLayer = point.layer
    const sourceZ = mapLayerNameToZ(sourceLayer, this.ogSrj.layerCount)
    const sourceObstacle = this.selectSourceObstacle({
      point,
      sourceLayer,
      connectionNetIds,
    })
    const candidates = this.getCandidatePositions(point, sourceObstacle)

    let bestCandidate: EscapeViaCandidate | null = null

    for (const copperPour of matchingCopperPours) {
      const targetLayer = copperPour.layers[0]
      if (!targetLayer || targetLayer === sourceLayer) continue

      const targetZ = mapLayerNameToZ(targetLayer, this.ogSrj.layerCount)
      const targetPourKey = getObstacleKey(copperPour)

      for (const candidate of candidates) {
        if (!this.isInsideBoard(candidate)) continue
        if (!isPointInRect(candidate, copperPour)) continue
        if (
          !this.hasClearEscapePath({
            sourcePoint: point,
            candidate,
            sourceLayer,
            sourceObstacle,
          })
        ) {
          continue
        }

        const minClearance = this.getMinBlockingClearance({
          candidate,
          connectionNetIds,
          sourceZ,
          targetZ,
        })
        if (minClearance + GEOMETRIC_TOLERANCE < this.obstacleMargin) continue

        const score =
          minClearance * 100 -
          distance(point, candidate) -
          Math.abs(targetZ - sourceZ) * 0.5

        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            pointId: `${ESCAPE_POINT_ID_PREFIX}${connection.name}:${point.pointId ?? `p${pointIndex}`}:${targetLayer}:${this.nextEscapeViaIndex++}`,
            x: candidate.x,
            y: candidate.y,
            connectionName: connection.name,
            rootConnectionName:
              connection.rootConnectionName ?? connection.name,
            sourcePointIndex: pointIndex,
            sourcePointId: point.pointId,
            sourceLayer,
            targetLayer,
            targetPourKey,
            score,
          }
        }
      }
    }

    return bestCandidate
  }

  _step() {
    const copperPours = this.ogSrj.obstacles.filter(
      (obstacle) => obstacle.isCopperPour,
    )

    const newConnections = this.ogSrj.connections.map((connection) => {
      const connectionNetIds = this.getConnectionNetIds(connection)
      const matchingCopperPours = copperPours.filter((obstacle) =>
        this.obstacleMatchesConnectionNet(obstacle, connectionNetIds),
      )

      if (matchingCopperPours.length === 0) {
        return structuredClone(connection)
      }

      const clonedConnection = structuredClone(connection)
      const addedPoints: ConnectionPoint[] = []
      const externallyConnectedPointIds = [
        ...(clonedConnection.externallyConnectedPointIds ?? []),
      ]
      const groupedEscapePointIds = new Map<string, string[]>()

      for (
        let pointIndex = 0;
        pointIndex < connection.pointsToConnect.length;
        pointIndex++
      ) {
        const point = connection.pointsToConnect[pointIndex]!
        const escapeViaCandidate = this.findBestEscapeViaCandidate({
          connection,
          point,
          pointIndex,
          matchingCopperPours,
          connectionNetIds,
        })

        if (!escapeViaCandidate) continue

        const alreadyExists = clonedConnection.pointsToConnect.some(
          (existing) =>
            isSingleLayerConnectionPoint(existing) &&
            existing.layer === escapeViaCandidate.sourceLayer &&
            pointMatches(existing, escapeViaCandidate),
        )
        if (alreadyExists) continue

        const escapePoint = {
          x: escapeViaCandidate.x,
          y: escapeViaCandidate.y,
          layer: escapeViaCandidate.sourceLayer,
          pointId: escapeViaCandidate.pointId,
        } satisfies ConnectionPoint

        addedPoints.push(escapePoint)
        this.escapeViaMetadataByPointId.set(
          escapeViaCandidate.pointId,
          escapeViaCandidate,
        )
        this.createdEscapeVias.push(escapeViaCandidate)

        const existingGroup = groupedEscapePointIds.get(
          escapeViaCandidate.targetPourKey,
        )
        if (existingGroup) {
          existingGroup.push(escapeViaCandidate.pointId)
        } else {
          groupedEscapePointIds.set(escapeViaCandidate.targetPourKey, [
            escapeViaCandidate.pointId,
          ])
        }
      }

      for (const pointIds of groupedEscapePointIds.values()) {
        if (pointIds.length > 1) {
          externallyConnectedPointIds.push(pointIds)
        }
      }

      if (addedPoints.length === 0) {
        return clonedConnection
      }

      clonedConnection.pointsToConnect = [
        ...clonedConnection.pointsToConnect,
        ...addedPoints,
      ]
      clonedConnection.externallyConnectedPointIds =
        externallyConnectedPointIds.length > 0
          ? externallyConnectedPointIds
          : undefined

      return clonedConnection
    })

    this.outputSrj = {
      ...structuredClone(this.ogSrj),
      connections: newConnections,
    }
    this.solved = true
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return structuredClone(this.outputSrj)
  }

  getEscapeViaMetadataByPointId(): Map<string, EscapeViaMetadata> {
    return new Map(this.escapeViaMetadataByPointId)
  }

  override visualize(): GraphicsObject {
    return {
      title: "Escape Via Location Solver",
      points: this.outputSrj.connections.flatMap((connection) =>
        connection.pointsToConnect.map((point) => ({
          x: point.x,
          y: point.y,
          color:
            point.pointId?.startsWith(ESCAPE_POINT_ID_PREFIX) === true
              ? "#0f766e"
              : "#dc2626",
          label:
            point.pointId?.startsWith(ESCAPE_POINT_ID_PREFIX) === true
              ? `${connection.name}\nescape via`
              : connection.name,
        })),
      ),
      lines: this.createdEscapeVias.map((escapeVia) => {
        const sourcePoint =
          this.outputSrj.connections.find(
            (connection) => connection.name === escapeVia.connectionName,
          )?.pointsToConnect[escapeVia.sourcePointIndex] ?? null

        return {
          points: sourcePoint
            ? [
                { x: sourcePoint.x, y: sourcePoint.y },
                { x: escapeVia.x, y: escapeVia.y },
              ]
            : [{ x: escapeVia.x, y: escapeVia.y }],
          strokeColor: "#0f766e",
        }
      }),
      circles: this.createdEscapeVias.map((escapeVia) => ({
        center: { x: escapeVia.x, y: escapeVia.y },
        radius: this.viaRadius,
        strokeColor: "#0f766e",
        label: `${escapeVia.connectionName}\n${escapeVia.targetLayer}`,
      })),
      rects: this.ogSrj.obstacles.map((obstacle) => ({
        ...obstacle,
        fill: obstacle.isCopperPour
          ? "rgba(16,185,129,0.10)"
          : "rgba(220,38,38,0.12)",
      })),
    }
  }
}
