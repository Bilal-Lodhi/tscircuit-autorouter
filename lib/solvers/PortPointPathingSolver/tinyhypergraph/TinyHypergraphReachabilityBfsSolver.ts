import type { GraphicsObject, Line, Rect } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { CapacityMeshNodeId } from "lib/types"
import type {
  ConnectionHg,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

type ExistingPathSnapshot = {
  regionSegments: Array<Array<[number, number, number]>>
  portX: Float64Array
  portY: Float64Array
}

type ReachabilityResult = {
  connectionId: string
  connectionIndex: number
  reachable: boolean
  visitedRegionIds: Set<CapacityMeshNodeId>
  unreachableRegionIds: Set<CapacityMeshNodeId>
  startRegionId: CapacityMeshNodeId
  endRegionId: CapacityMeshNodeId
}

export type TinyHypergraphReachabilityBfsParams = {
  graph: HyperGraphHg
  connections: ConnectionHg[]
  currentRouteId?: number
  existingPath?: ExistingPathSnapshot
  globalIteration?: number
}

const getConnectionDisplayName = (connection: ConnectionHg) =>
  connection.simpleRouteConnection?.name ?? connection.connectionId

const getConnectionPoint = (
  connection: ConnectionHg,
  index: 0 | 1,
): { x: number; y: number } =>
  connection.simpleRouteConnection?.pointsToConnect[index] ??
  (index === 0
    ? connection.startRegion.d.center
    : connection.endRegion.d.center)

export class TinyHypergraphReachabilityBfsSolver extends BaseSolver {
  private regionById: Map<CapacityMeshNodeId, RegionHg>
  private results: ReachabilityResult[] = []
  private connectionIndices: number[]

  constructor(private params: TinyHypergraphReachabilityBfsParams) {
    super()
    this.MAX_ITERATIONS = 1
    this.regionById = new Map(
      params.graph.regions.map((region) => [region.regionId, region]),
    )
    if (
      typeof params.currentRouteId === "number" &&
      params.currentRouteId >= 0 &&
      params.currentRouteId < params.connections.length
    ) {
      this.connectionIndices = [params.currentRouteId]
    } else {
      this.connectionIndices = params.connections.map((_, index) => index)
    }
  }

  getSolverName(): string {
    return "TinyHypergraphReachabilityBfsSolver"
  }

  _step() {
    this.results = this.connectionIndices.map((index) =>
      this.computeReachability(index, this.params.connections[index]!),
    )
    this.results.forEach((result) => {
      const iterationTag =
        typeof this.params.globalIteration === "number"
          ? ` iter=${this.params.globalIteration}`
          : ""
      console.log(
        `[TinyHypergraphReachabilityBfsSolver] ${result.connectionId} reachable=${result.reachable}${iterationTag}`,
      )
    })
    this.stats = {
      ...this.stats,
      reachability: this.results.map((result) => ({
        connectionId: result.connectionId,
        reachable: result.reachable,
        visitedRegionCount: result.visitedRegionIds.size,
        unreachableRegionCount: result.unreachableRegionIds.size,
      })),
    }
    this.solved = true
  }

  getResults(): ReachabilityResult[] {
    return this.results
  }

  visualize(): GraphicsObject {
    if (this.results.length === 0) {
      return {}
    }

    const getRegionLabel = (region: RegionHg) =>
      [
        `regionId: ${region.regionId}`,
        `z: ${region.d.availableZ.join(", ")}`,
      ].join("\n")

    const obstacleRects: Rect[] = this.params.graph.regions
      .filter((region) => region.d._containsObstacle)
      .map((region) => ({
        center: region.d.center,
        width: region.d.width,
        height: region.d.height,
        fill: "rgba(255, 0, 0, 0.6)",
        label: getRegionLabel(region),
      }))

    const unreachableRegionIds = new Set<CapacityMeshNodeId>()
    const visitedRegionIds = new Set<CapacityMeshNodeId>()
    for (const result of this.results) {
      result.unreachableRegionIds.forEach((id) => unreachableRegionIds.add(id))
      result.visitedRegionIds.forEach((id) => visitedRegionIds.add(id))
    }

    const unreachableRects: Rect[] = Array.from(unreachableRegionIds)
      .map((regionId) => this.regionById.get(regionId))
      .filter(Boolean)
      .map((region) => ({
        center: region!.d.center,
        width: region!.d.width,
        height: region!.d.height,
        fill: "rgba(255, 165, 0, 0.35)",
        label: getRegionLabel(region!),
      }))

    const visitedRects: Rect[] = Array.from(visitedRegionIds)
      .map((regionId) => this.regionById.get(regionId))
      .filter(Boolean)
      .filter((region) => !region!.d._containsObstacle)
      .map((region) => ({
        center: region!.d.center,
        width: region!.d.width,
        height: region!.d.height,
        fill: "rgba(0, 140, 255, 0.22)",
        label: getRegionLabel(region!),
      }))

    const visitedPortPoints = this.params.graph.ports
      .filter((port) =>
        port.d.regions.some((region) => visitedRegionIds.has(region.regionId)),
      )
      .map((port) => ({
        label: [
          `portId: ${port.portId}`,
          `z: ${port.d.z}`,
          `regions: ${port.d.regions
            .map((region) => region.regionId)
            .join(", ")}`,
        ].join("\n"),
        x: port.d.x,
        y: port.d.y,
        color: "rgba(0, 140, 255, 0.9)",
      }))

    const connectionLines: Line[] = this.results.map((result) => {
      const connection = this.params.connections[result.connectionIndex]
      if (!connection) {
        return {
          points: [],
          strokeColor: "rgba(255, 255, 255, 0.4)",
        }
      }
      const startPoint = getConnectionPoint(connection, 0)
      const endPoint = getConnectionPoint(connection, 1)
      return {
        points: [startPoint, endPoint],
        strokeColor: "rgba(0, 180, 255, 0.9)",
        strokeDash: "3 3",
        strokeWidth: 0.03,
      }
    })

    const existingPathLines: Line[] = []
    if (this.params.existingPath) {
      const { regionSegments, portX, portY } = this.params.existingPath
      const activeRouteIds = new Set(this.connectionIndices)
      const regionSegmentsCount = regionSegments.length
      const hasRouteIndexedSegments =
        regionSegmentsCount === this.params.connections.length
      const routeIdsToDraw = new Set<number>()
      if (hasRouteIndexedSegments) {
        activeRouteIds.forEach((routeId) => routeIdsToDraw.add(routeId))
      } else {
        for (const segments of regionSegments) {
          for (const [routeId] of segments) {
            routeIdsToDraw.add(routeId)
          }
        }
      }
      for (const segments of regionSegments) {
        for (const [routeId, fromPortId, toPortId] of segments) {
          if (routeIdsToDraw.size > 0 && !routeIdsToDraw.has(routeId)) {
            continue
          }
          existingPathLines.push({
            points: [
              { x: portX[fromPortId], y: portY[fromPortId] },
              { x: portX[toPortId], y: portY[toPortId] },
            ],
            strokeColor: "rgba(0, 200, 255, 1)",
            strokeWidth: 0.18,
          })
        }
      }
    }

    return {
      rects: [...obstacleRects, ...visitedRects, ...unreachableRects],
      points: visitedPortPoints,
      lines: [...connectionLines, ...existingPathLines],
    }
  }

  private computeReachability(
    connectionIndex: number,
    connection: ConnectionHg,
  ): ReachabilityResult {
    const startRegionId = connection.startRegion.regionId
    const endRegionId = connection.endRegion.regionId
    const visitedRegionIds = new Set<CapacityMeshNodeId>()
    const queue: CapacityMeshNodeId[] = []

    if (this.isRegionAllowed(startRegionId, startRegionId, endRegionId)) {
      visitedRegionIds.add(startRegionId)
      queue.push(startRegionId)
    }

    while (queue.length > 0) {
      const regionId = queue.shift()!
      if (regionId === endRegionId) {
        break
      }

      const region = this.regionById.get(regionId)
      if (!region) {
        continue
      }

      if (
        regionId !== startRegionId &&
        regionId !== endRegionId &&
        !this.regionHasAvailablePorts(region)
      ) {
        continue
      }

      for (const port of region.ports) {
        if (!this.portIsAvailableInRegion(port, region)) {
          continue
        }
        const neighbor = port.d.regions.find(
          (candidate) => candidate.regionId !== regionId,
        )
        if (!neighbor) {
          continue
        }
        if (!this.isRegionAllowed(neighbor.regionId, startRegionId, endRegionId)) {
          continue
        }
        if (!visitedRegionIds.has(neighbor.regionId)) {
          visitedRegionIds.add(neighbor.regionId)
          queue.push(neighbor.regionId)
        }
      }
    }

    const reachable = visitedRegionIds.has(endRegionId)
    const unreachableRegionIds = new Set<CapacityMeshNodeId>()
    for (const regionId of this.regionById.keys()) {
      if (!visitedRegionIds.has(regionId)) {
        const region = this.regionById.get(regionId)
        if (!region?.d._containsObstacle) {
          unreachableRegionIds.add(regionId)
        }
      }
    }

    return {
      connectionId: getConnectionDisplayName(connection),
      connectionIndex,
      reachable,
      visitedRegionIds,
      unreachableRegionIds,
      startRegionId,
      endRegionId,
    }
  }

  private isRegionAllowed(
    regionId: CapacityMeshNodeId,
    startRegionId: CapacityMeshNodeId,
    endRegionId: CapacityMeshNodeId,
  ): boolean {
    if (regionId === startRegionId || regionId === endRegionId) {
      return true
    }
    const region = this.regionById.get(regionId)
    if (!region) {
      return false
    }
    return !region.d._containsObstacle
  }

  private regionHasAvailablePorts(region: RegionHg): boolean {
    const availableZ = region.d.availableZ
    if (!availableZ || availableZ.length === 0) {
      return region.ports.length > 0
    }
    return region.ports.some((port) => availableZ.includes(port.d.z))
  }

  private portIsAvailableInRegion(port: RegionPortHg, region: RegionHg): boolean {
    const availableZ = region.d.availableZ
    if (!availableZ || availableZ.length === 0) {
      return true
    }
    return availableZ.includes(port.d.z)
  }
}
