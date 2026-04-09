import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import {
  DEFAULT_FORCE_IMPROVEMENT_PASSES,
  repairSample,
  type HighDensityRepair01Input,
  type NodeHdRoute as RepairNodeHdRoute,
  type RepairSampleResult,
} from "high-density-repair01"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { Obstacle } from "lib/types/srj-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { safeTransparentize } from "../colors"
import { BaseSolver } from "../BaseSolver"

type ForceImprovementSampleEntry = {
  node: NodeWithPortPoints
  routeIndexes: number[]
  sample: HighDensityRepair01Input
}

type SamplePortPoint = NodeWithPortPoints["portPoints"][number] & {
  keepoutRadius: number
}

const DEFAULT_REPAIR_MARGIN = 0.2
const SUPPORTED_BOARD_LAYERS = new Set(["top", "inner1", "inner2", "bottom"])

const doesRectOverlap = (
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

const getNodeBounds = (node: NodeWithPortPoints, margin = 0) => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

const getObstacleBounds = (obstacle: Obstacle) => ({
  minX: obstacle.center.x - obstacle.width / 2,
  maxX: obstacle.center.x + obstacle.width / 2,
  minY: obstacle.center.y - obstacle.height / 2,
  maxY: obstacle.center.y + obstacle.height / 2,
})

const isPointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
  margin = 0,
) => {
  const bounds = getNodeBounds(node, margin)
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

const getPortPointSampleSignature = (
  portPoint: SamplePortPoint,
) =>
  [
    portPoint.connectionName,
    portPoint.rootConnectionName ?? "",
    portPoint.portPointId ?? "",
    portPoint.x,
    portPoint.y,
    portPoint.z,
    portPoint.keepoutRadius,
  ].join("|")

const inferPortPointKeepoutRadius = (ownerNode: NodeWithPortPoints) => {
  const minDimension = Math.min(ownerNode.width, ownerNode.height)
  if (minDimension >= 1.5) {
    return 0.25
  }

  return Math.max(0.25, Math.min(minDimension, 0.9) * 0.5)
}

const getSamplePortPoints = (
  node: NodeWithPortPoints,
  allNodes: NodeWithPortPoints[],
  margin: number,
) => {
  const samplePortPoints: SamplePortPoint[] = []
  const seenPortPoints = new Set<string>()

  for (const candidateNode of allNodes) {
    for (const portPoint of candidateNode.portPoints) {
      if (!isPointInsideNode(portPoint, node, margin)) {
        continue
      }

      const samplePortPoint: SamplePortPoint = {
        ...portPoint,
        keepoutRadius: inferPortPointKeepoutRadius(candidateNode),
      }
      const signature = getPortPointSampleSignature(samplePortPoint)
      if (seenPortPoints.has(signature)) {
        continue
      }

      seenPortPoints.add(signature)
      samplePortPoints.push(samplePortPoint)
    }
  }

  return samplePortPoints
}

const getRouteNodeConnectionMatchScore = (
  route: HighDensityRoute,
  node: NodeWithPortPoints,
) => {
  let score = 0

  for (const portPoint of node.portPoints) {
    if (portPoint.connectionName === route.connectionName) {
      score += 3
    }
    if (
      route.rootConnectionName &&
      portPoint.rootConnectionName === route.rootConnectionName
    ) {
      score += 2
    }
    if (
      route.rootConnectionName &&
      portPoint.connectionName === route.rootConnectionName
    ) {
      score += 1
    }
    if (
      route.rootConnectionName &&
      portPoint.rootConnectionName === route.connectionName
    ) {
      score += 1
    }
  }

  return score
}

const findNodeIndexForRoute = (
  route: HighDensityRoute,
  nodes: NodeWithPortPoints[],
  margin: number,
): number => {
  const routePoints = route.route.map(({ x, y }) => ({ x, y }))
  const viaPoints = route.vias.map(({ x, y }) => ({ x, y }))
  const points = [...routePoints, ...viaPoints]
  let bestNodeIndex = -1
  let bestMatchScore = -1
  let bestArea = Infinity

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!points.every((point) => isPointInsideNode(point, node, margin))) {
      continue
    }

    const matchScore = getRouteNodeConnectionMatchScore(route, node)
    const area = node.width * node.height

    if (
      matchScore > bestMatchScore ||
      (matchScore === bestMatchScore && area < bestArea)
    ) {
      bestNodeIndex = i
      bestMatchScore = matchScore
      bestArea = area
    }
  }

  return bestNodeIndex
}

const isSupportedZ = (z: number): z is 0 | 1 => z === 0 || z === 1

const getSupportedAvailableZ = (
  node: NodeWithPortPoints,
  routeGroup: HighDensityRoute[],
  layerCount: number,
): Array<0 | 1> => {
  const preferredLayers = (node.availableZ ?? []).filter(isSupportedZ)
  if (preferredLayers.length > 0) {
    return Array.from(new Set(preferredLayers))
  }

  const pointLayers = node.portPoints.map((portPoint) => portPoint.z)
  const routeLayers = routeGroup.flatMap((route) =>
    route.route.map((point) => point.z),
  )
  const discoveredLayers = [...pointLayers, ...routeLayers].filter(isSupportedZ)

  if (discoveredLayers.length > 0) {
    return Array.from(new Set(discoveredLayers))
  }

  return layerCount <= 1 ? [0] : [0, 1]
}

const isRepair01Compatible = (
  node: NodeWithPortPoints,
  routeGroup: HighDensityRoute[],
) => {
  if (node.portPoints.some((portPoint) => !isSupportedZ(portPoint.z))) {
    return false
  }

  return routeGroup.every((route) =>
    route.route.every((point) => isSupportedZ(point.z)),
  )
}

const toRepairRoute = (
  route: HighDensityRoute,
  node: NodeWithPortPoints,
): RepairNodeHdRoute => ({
  capacityMeshNodeId: node.capacityMeshNodeId,
  connectionName: route.connectionName,
  rootConnectionName: route.rootConnectionName ?? route.connectionName,
  route: route.route.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z as 0 | 1,
    insideJumperPad: point.insideJumperPad,
  })),
  traceThickness: route.traceThickness,
  viaDiameter: route.viaDiameter,
  vias: route.vias.map((via) => ({
    x: via.x,
    y: via.y,
  })),
})

const fromRepairRoute = (
  route: RepairNodeHdRoute,
  fallbackRoute: HighDensityRoute,
): HighDensityRoute => {
  const rootConnectionName =
    route.rootConnectionName ?? fallbackRoute.rootConnectionName
  const shouldIncludeRootConnectionName =
    fallbackRoute.rootConnectionName !== undefined ||
    (route.rootConnectionName !== undefined &&
      route.rootConnectionName !== route.connectionName)
  const jumpers = fallbackRoute.jumpers

  return {
    connectionName: route.connectionName ?? fallbackRoute.connectionName,
    ...(shouldIncludeRootConnectionName && rootConnectionName
      ? { rootConnectionName }
      : {}),
    traceThickness: route.traceThickness ?? fallbackRoute.traceThickness,
    viaDiameter: route.viaDiameter ?? fallbackRoute.viaDiameter,
    route:
      route.route?.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
        ...(point.insideJumperPad !== undefined
          ? { insideJumperPad: point.insideJumperPad }
          : {}),
      })) ?? fallbackRoute.route,
    vias:
      route.vias?.map((via) => ({
        x: via.x,
        y: via.y,
      })) ?? fallbackRoute.vias,
    ...(jumpers ? { jumpers } : {}),
  }
}

const toRepairConnectivityMap = (connMap: ConnectivityMap) => {
  const connMapRecord = connMap as unknown as {
    idToNetMap?: Record<string, string>
    netMap?: Record<string, string[]>
  }

  return {
    idToNetMap: { ...(connMapRecord.idToNetMap ?? {}) },
    netMap: Object.fromEntries(
      Object.entries(connMapRecord.netMap ?? {}).map(([netName, ids]) => [
        netName,
        [...ids],
      ]),
    ),
  }
}

const getAdjacentObstacles = (
  node: NodeWithPortPoints,
  obstacleSHI: ObstacleSpatialHashIndex,
  margin: number,
) => {
  const expandedNodeBounds = getNodeBounds(node, margin)

  return obstacleSHI
    .search(expandedNodeBounds)
    .filter((obstacle) =>
      doesRectOverlap(expandedNodeBounds, getObstacleBounds(obstacle)),
    )
    .map((obstacle) => ({
      type: obstacle.type,
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      connectedTo: [...obstacle.connectedTo],
      layers: obstacle.layers.filter((layer) =>
        SUPPORTED_BOARD_LAYERS.has(layer),
      ) as Array<"top" | "inner1" | "inner2" | "bottom">,
    }))
}

const createRepairSample = (params: {
  node: NodeWithPortPoints
  allNodes: NodeWithPortPoints[]
  routeIndexes: number[]
  hdRoutes: HighDensityRoute[]
  obstacleSHI: ObstacleSpatialHashIndex
  connMap: ConnectivityMap
  repairMargin: number
  layerCount: number
}): ForceImprovementSampleEntry | null => {
  const {
    node,
    allNodes,
    routeIndexes,
    hdRoutes,
    obstacleSHI,
    connMap,
    repairMargin,
  } =
    params
  const routeGroup = routeIndexes.map((routeIndex) => hdRoutes[routeIndex])

  if (!isRepair01Compatible(node, routeGroup)) {
    return null
  }

  return {
    node,
    routeIndexes,
    sample: {
      connMap: toRepairConnectivityMap(connMap),
      nodeWithPortPoints: {
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: { ...node.center },
        width: node.width,
        height: node.height,
        availableZ: getSupportedAvailableZ(
          node,
          routeGroup,
          params.layerCount,
        ),
        portPoints: getSamplePortPoints(node, allNodes, repairMargin).map(
          (portPoint, index) => ({
          x: portPoint.x,
          y: portPoint.y,
          z: portPoint.z as 0 | 1,
          connectionName: portPoint.connectionName,
          rootConnectionName:
            portPoint.rootConnectionName ?? portPoint.connectionName,
          keepoutRadius: portPoint.keepoutRadius,
          portPointId:
            portPoint.portPointId ??
            `${node.capacityMeshNodeId}-port-point-${index}`,
          }),
        ),
      },
      nodeHdRoutes: routeGroup.map((route) => toRepairRoute(route, node)),
      adjacentObstacles: getAdjacentObstacles(node, obstacleSHI, repairMargin),
    },
  }
}

export class HighDensityNodeForceImprovementSolver extends BaseSolver {
  readonly repairMargin: number
  readonly layerCount: number
  readonly forceImprovementPasses: number
  readonly sampleEntries: ForceImprovementSampleEntry[]
  readonly originalHdRoutes: HighDensityRoute[]
  readonly originalNodeWithPortPoints: NodeWithPortPoints[]
  readonly originalObstacles: Obstacle[]
  readonly originalConnMap: ConnectivityMap
  readonly obstacleSHI: ObstacleSpatialHashIndex
  readonly colorMap: Record<string, string>

  repairedRoutesByIndex = new Map<number, HighDensityRoute>()
  repairResultsByNodeId = new Map<string, RepairSampleResult>()
  activeSampleIndex = 0
  improvedNodeCount = 0
  repairedNodeCount = 0

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    obstacles: Obstacle[]
    connMap: ConnectivityMap
    layerCount: number
    repairMargin?: number
    forceImprovementPasses?: number
    colorMap?: Record<string, string>
  }) {
    super()
    this.repairMargin = params.repairMargin ?? DEFAULT_REPAIR_MARGIN
    this.layerCount = params.layerCount
    this.forceImprovementPasses =
      params.forceImprovementPasses ?? DEFAULT_FORCE_IMPROVEMENT_PASSES
    this.originalHdRoutes = params.hdRoutes
    this.originalNodeWithPortPoints = params.nodeWithPortPoints
    this.originalObstacles = params.obstacles
    this.originalConnMap = params.connMap
    this.obstacleSHI = new ObstacleSpatialHashIndex(
      "flatbush",
      this.originalObstacles,
    )
    this.colorMap = params.colorMap ?? {}

    const routeIndexesByNode = new Map<number, number[]>()
    for (let i = 0; i < params.hdRoutes.length; i += 1) {
      const nodeIndex = findNodeIndexForRoute(
        params.hdRoutes[i],
        params.nodeWithPortPoints,
        this.repairMargin,
      )
      if (nodeIndex === -1) continue
      const routeIndexes = routeIndexesByNode.get(nodeIndex) ?? []
      routeIndexes.push(i)
      routeIndexesByNode.set(nodeIndex, routeIndexes)
    }

    this.sampleEntries = Array.from(routeIndexesByNode.entries())
      .map(([nodeIndex, routeIndexes]) =>
        createRepairSample({
          node: params.nodeWithPortPoints[nodeIndex],
          allNodes: params.nodeWithPortPoints,
          routeIndexes,
          hdRoutes: params.hdRoutes,
          obstacleSHI: this.obstacleSHI,
          connMap: params.connMap,
          repairMargin: this.repairMargin,
          layerCount: this.layerCount,
        }),
      )
      .filter((entry): entry is ForceImprovementSampleEntry => entry !== null)

    this.MAX_ITERATIONS = Math.max(this.sampleEntries.length * 10, 10_000)
    this.stats = {
      forceImprovementPasses: this.forceImprovementPasses,
      improvedNodeCount: 0,
      repairedNodeCount: 0,
      repairedRouteCount: 0,
      sampleCount: this.sampleEntries.length,
    }
  }

  override getSolverName(): string {
    return "HighDensityNodeForceImprovementSolver"
  }

  override getConstructorParams() {
    return [
      {
        nodeWithPortPoints: this.originalNodeWithPortPoints,
        hdRoutes: this.originalHdRoutes,
        obstacles: this.originalObstacles,
        connMap: this.originalConnMap,
        layerCount: this.layerCount,
        repairMargin: this.repairMargin,
        forceImprovementPasses: this.forceImprovementPasses,
        colorMap: this.colorMap,
      },
    ] as const
  }

  override _step() {
    const sampleEntry = this.sampleEntries[this.activeSampleIndex]

    if (!sampleEntry) {
      this.solved = true
      return
    }

    const repairResult = repairSample(sampleEntry.sample, {
      forceImprovementPasses: this.forceImprovementPasses,
      simplifyBeforeImprove: false,
    })
    this.repairResultsByNodeId.set(
      sampleEntry.node.capacityMeshNodeId,
      repairResult,
    )
    const shouldApplyStructuralNormalization =
      repairResult.selectedStage === "normalized" &&
      repairResult.repaired &&
      repairResult.originalDrc.issues.every(
        (issue) =>
          issue.kind === "invalid-route" || issue.kind === "out-of-bounds",
      )
    const shouldApplyForceImprovement =
      repairResult.selectedStage === "force-improved" && repairResult.improved
    const shouldApplyRepairResult =
      shouldApplyStructuralNormalization || shouldApplyForceImprovement
    this.improvedNodeCount += shouldApplyRepairResult ? 1 : 0
    this.repairedNodeCount += repairResult.repaired ? 1 : 0

    for (let i = 0; i < sampleEntry.routeIndexes.length; i += 1) {
      const routeIndex = sampleEntry.routeIndexes[i]
      const fallbackRoute = this.originalHdRoutes[routeIndex]
      const repairedRoute = shouldApplyRepairResult
        ? repairResult.sample.nodeHdRoutes[i]
        : null
      this.repairedRoutesByIndex.set(
        routeIndex,
        repairedRoute
          ? fromRepairRoute(repairedRoute, fallbackRoute)
          : fallbackRoute,
      )
    }

    this.activeSampleIndex += 1
    this.stats = {
      forceImprovementPasses: this.forceImprovementPasses,
      improvedNodeCount: this.improvedNodeCount,
      repairedNodeCount: this.repairedNodeCount,
      repairedRouteCount: this.repairedRoutesByIndex.size,
      sampleCount: this.sampleEntries.length,
    }

    if (this.activeSampleIndex >= this.sampleEntries.length) {
      this.solved = true
    }
  }

  getOutput(): HighDensityRoute[] {
    return this.originalHdRoutes.map(
      (route, index) => this.repairedRoutesByIndex.get(index) ?? route,
    )
  }

  override visualize(): GraphicsObject {
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const circles: NonNullable<GraphicsObject["circles"]> = []

    for (const route of this.getOutput()) {
      const strokeColor = this.colorMap[route.connectionName] ?? "#0ea5e9"
      for (let i = 0; i < route.route.length - 1; i += 1) {
        const start = route.route[i]
        const end = route.route[i + 1]
        if (start.z !== end.z) continue
        lines.push({
          points: [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
          ],
          strokeColor:
            start.z === 0 ? strokeColor : safeTransparentize(strokeColor, 0.5),
          strokeWidth: route.traceThickness,
          layer: `z${start.z}`,
          strokeDash: start.z !== 0 ? [0.1, 0.3] : undefined,
        })
      }
      for (const via of route.vias) {
        circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          stroke: strokeColor,
          fill: "rgba(14,165,233,0.12)",
        })
      }
    }

    return {
      title: "High Density Node Force Improvement",
      lines,
      circles,
    }
  }
}
