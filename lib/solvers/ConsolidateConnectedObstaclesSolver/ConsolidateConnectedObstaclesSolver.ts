import { BaseSolver } from "lib/solvers/BaseSolver"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"

type ObstacleWithRuntimeType = Obstacle & { type?: string }

type Bbox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type IndexedObstacle = {
  inputIndex: number
  obstacle: ObstacleWithRuntimeType
  rootConnectionName: string
}

type CandidateEdge = {
  a: number
  b: number
  gap: number
  inflation: number
}

type MergeComponent = {
  rootConnectionName: string
  inputIndexes: number[]
  mergedObstacle: Obstacle
}

export interface ConsolidateConnectedObstaclesSolverOptions {
  maxMergeGap?: number
  maxAreaInflation?: number
}

const getObstacleBbox = (obstacle: ObstacleWithRuntimeType): Bbox => ({
  minX: obstacle.center.x - obstacle.width / 2,
  minY: obstacle.center.y - obstacle.height / 2,
  maxX: obstacle.center.x + obstacle.width / 2,
  maxY: obstacle.center.y + obstacle.height / 2,
})

const getBboxArea = (bbox: Bbox) =>
  Math.max(0, bbox.maxX - bbox.minX) * Math.max(0, bbox.maxY - bbox.minY)

const getBboxGap = (a: Bbox, b: Bbox) => ({
  gapX: Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX)),
  gapY: Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY)),
})

const unionBboxes = (a: Bbox, b: Bbox): Bbox => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
})

const getLayerKey = (obstacle: ObstacleWithRuntimeType) =>
  obstacle.layers.slice().sort().join("|")

const getZLayerKey = (obstacle: ObstacleWithRuntimeType) =>
  obstacle.zLayers
    ? obstacle.zLayers
        .slice()
        .sort((a, b) => a - b)
        .join("|")
    : ""

const getOffboardKey = (obstacle: ObstacleWithRuntimeType) =>
  (obstacle.offBoardConnectsTo ?? []).slice().sort().join("|")

const getConnectionIdsForRootResolution = (
  connection: SimpleRouteConnection,
  rootConnectionName: string,
) => {
  const ids = new Set<string>([
    rootConnectionName,
    connection.name,
    ...(connection.mergedConnectionNames ?? []),
  ])

  for (const point of connection.pointsToConnect) {
    if (point.pointId) ids.add(point.pointId)
    if ("pcb_port_id" in point && point.pcb_port_id) {
      ids.add(point.pcb_port_id)
    }
  }

  return ids
}

export class ConsolidateConnectedObstaclesSolver extends BaseSolver {
  outputSrj: SimpleRouteJson
  mergedComponents: MergeComponent[] = []
  maxMergeGap: number
  maxAreaInflation: number

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly opts: ConsolidateConnectedObstaclesSolverOptions = {},
  ) {
    super()
    this.outputSrj = inputSrj
    this.maxMergeGap =
      opts.maxMergeGap ??
      Math.max(inputSrj.minTraceWidth, inputSrj.defaultObstacleMargin ?? 0.15)
    this.maxAreaInflation = opts.maxAreaInflation ?? 1.25
    this.MAX_ITERATIONS = 1
  }

  getConstructorParams() {
    return [this.inputSrj, this.opts] as const
  }

  _step() {
    this.outputSrj = this.createConsolidatedSimpleRouteJson()
    this.solved = true
  }

  getOutputSimpleRouteJson() {
    if (!this.solved) {
      throw new Error("Cannot get output before solving is complete")
    }
    return this.outputSrj
  }

  private buildIdToRootConnectionNameMap() {
    const idToRootConnectionName = new Map<string, string>()

    for (const connection of this.inputSrj.connections) {
      const rootConnectionName =
        connection.rootConnectionName ?? connection.name

      for (const id of getConnectionIdsForRootResolution(
        connection,
        rootConnectionName,
      )) {
        if (!idToRootConnectionName.has(id)) {
          idToRootConnectionName.set(id, rootConnectionName)
        }
      }
    }

    return idToRootConnectionName
  }

  private resolveRootConnectionNamesForObstacle(
    obstacle: ObstacleWithRuntimeType,
    idToRootConnectionName: Map<string, string>,
    netToRootConnectionNames: Map<string, string[]>,
    connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson>,
  ) {
    const rootConnectionNames = new Set<string>()
    const idsToResolve = new Set<string>([
      ...(obstacle.connectedTo ?? []),
      ...(obstacle.offBoardConnectsTo ?? []),
    ])

    if (obstacle.obstacleId) {
      idsToResolve.add(obstacle.obstacleId)
    }

    for (const id of idsToResolve) {
      const directRootConnectionName = idToRootConnectionName.get(id)
      if (directRootConnectionName) {
        rootConnectionNames.add(directRootConnectionName)
        continue
      }

      const netId = connMap.getNetConnectedToId(id)
      if (!netId) continue

      if (!netToRootConnectionNames.has(netId)) {
        const connectedIds = connMap.getIdsConnectedToNet(netId) ?? []
        const rootsOnNet = Array.from(
          new Set(
            connectedIds
              .map((connectedId) => idToRootConnectionName.get(connectedId))
              .filter(Boolean),
          ),
        ) as string[]
        netToRootConnectionNames.set(netId, rootsOnNet)
      }

      for (const rootConnectionName of netToRootConnectionNames.get(netId) ??
        []) {
        rootConnectionNames.add(rootConnectionName)
      }
    }

    return Array.from(rootConnectionNames)
  }

  private getMergeGroupKey(
    obstacle: ObstacleWithRuntimeType,
    rootConnectionName: string,
  ) {
    return [
      rootConnectionName,
      getLayerKey(obstacle),
      getZLayerKey(obstacle),
      obstacle.netIsAssignable ? "assignable" : "fixed",
      getOffboardKey(obstacle),
    ].join("::")
  }

  private buildMergeComponents(obstacles: IndexedObstacle[]): MergeComponent[] {
    if (obstacles.length === 0) return []

    if (obstacles.length === 1) {
      const onlyObstacle = obstacles[0]!
      return [
        {
          rootConnectionName: onlyObstacle.rootConnectionName,
          inputIndexes: [onlyObstacle.inputIndex],
          mergedObstacle: structuredClone(onlyObstacle.obstacle) as Obstacle,
        },
      ]
    }

    const index = new FlatbushIndex<number>(obstacles.length)
    const bboxes = obstacles.map(({ obstacle }) => getObstacleBbox(obstacle))
    const coveredAreas = obstacles.map(
      ({ obstacle }) => obstacle.width * obstacle.height,
    )
    const parent = obstacles.map((_, obstacleIndex) => obstacleIndex)
    const rank = obstacles.map(() => 0)

    for (
      let obstacleIndex = 0;
      obstacleIndex < obstacles.length;
      obstacleIndex++
    ) {
      const bbox = bboxes[obstacleIndex]!
      index.insert(obstacleIndex, bbox.minX, bbox.minY, bbox.maxX, bbox.maxY)
    }
    index.finish()

    const candidateEdges: CandidateEdge[] = []
    for (
      let obstacleIndex = 0;
      obstacleIndex < obstacles.length;
      obstacleIndex++
    ) {
      const bbox = bboxes[obstacleIndex]!
      const nearbyObstacleIndexes = index.search(
        bbox.minX - this.maxMergeGap,
        bbox.minY - this.maxMergeGap,
        bbox.maxX + this.maxMergeGap,
        bbox.maxY + this.maxMergeGap,
      )

      for (const nearbyObstacleIndex of nearbyObstacleIndexes) {
        if (nearbyObstacleIndex <= obstacleIndex) continue

        const nearbyBbox = bboxes[nearbyObstacleIndex]!
        const { gapX, gapY } = getBboxGap(bbox, nearbyBbox)
        if (gapX > this.maxMergeGap || gapY > this.maxMergeGap) continue

        const unionBbox = unionBboxes(bbox, nearbyBbox)
        const inflation =
          getBboxArea(unionBbox) /
          (coveredAreas[obstacleIndex]! + coveredAreas[nearbyObstacleIndex]!)

        if (inflation > this.maxAreaInflation) continue

        candidateEdges.push({
          a: obstacleIndex,
          b: nearbyObstacleIndex,
          gap: gapX + gapY,
          inflation,
        })
      }
    }

    candidateEdges.sort((a, b) => a.gap - b.gap || a.inflation - b.inflation)

    const find = (obstacleIndex: number): number => {
      if (parent[obstacleIndex] === obstacleIndex) return obstacleIndex
      parent[obstacleIndex] = find(parent[obstacleIndex]!)
      return parent[obstacleIndex]!
    }

    const tryUnion = (a: number, b: number) => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA === rootB) return

      const bboxA = bboxes[rootA]!
      const bboxB = bboxes[rootB]!
      const { gapX, gapY } = getBboxGap(bboxA, bboxB)
      if (gapX > this.maxMergeGap || gapY > this.maxMergeGap) return

      const mergedBbox = unionBboxes(bboxA, bboxB)
      const mergedArea = getBboxArea(mergedBbox)
      const areaInflation =
        mergedArea / (coveredAreas[rootA]! + coveredAreas[rootB]!)
      if (areaInflation > this.maxAreaInflation) return

      let parentRoot = rootA
      let childRoot = rootB
      if (rank[parentRoot]! < rank[childRoot]!) {
        parentRoot = rootB
        childRoot = rootA
      }

      parent[childRoot] = parentRoot
      if (rank[parentRoot] === rank[childRoot]) {
        rank[parentRoot]! += 1
      }

      bboxes[parentRoot] = mergedBbox
      coveredAreas[parentRoot] += coveredAreas[childRoot]!
    }

    for (const candidateEdge of candidateEdges) {
      tryUnion(candidateEdge.a, candidateEdge.b)
    }

    const componentIndexes = new Map<number, number[]>()
    for (
      let obstacleIndex = 0;
      obstacleIndex < obstacles.length;
      obstacleIndex++
    ) {
      const rootIndex = find(obstacleIndex)
      const component = componentIndexes.get(rootIndex)
      if (component) {
        component.push(obstacleIndex)
      } else {
        componentIndexes.set(rootIndex, [obstacleIndex])
      }
    }

    return Array.from(componentIndexes.values()).map((memberIndexes) => {
      const sortedMemberIndexes = memberIndexes.slice().sort((a, b) => a - b)
      const members = sortedMemberIndexes.map(
        (memberIndex) => obstacles[memberIndex]!,
      )
      const firstMember = members[0]!

      if (members.length === 1) {
        return {
          rootConnectionName: firstMember.rootConnectionName,
          inputIndexes: [firstMember.inputIndex],
          mergedObstacle: structuredClone(firstMember.obstacle) as Obstacle,
        }
      }

      const mergedBbox = sortedMemberIndexes
        .map((memberIndex) => bboxes[find(memberIndex)]!)
        .reduce((currentBbox, nextBbox) => unionBboxes(currentBbox, nextBbox))

      const connectedTo = Array.from(
        new Set(
          members.flatMap(({ obstacle }) => [
            ...(obstacle.connectedTo ?? []),
            ...(obstacle.obstacleId ? [obstacle.obstacleId] : []),
          ]),
        ),
      )

      const offBoardConnectsTo = Array.from(
        new Set(
          members.flatMap(({ obstacle }) => obstacle.offBoardConnectsTo ?? []),
        ),
      )

      const mergedObstacle: Obstacle = {
        type: "rect",
        layers: firstMember.obstacle.layers.slice(),
        center: {
          x: (mergedBbox.minX + mergedBbox.maxX) / 2,
          y: (mergedBbox.minY + mergedBbox.maxY) / 2,
        },
        width: mergedBbox.maxX - mergedBbox.minX,
        height: mergedBbox.maxY - mergedBbox.minY,
        connectedTo,
        ...(firstMember.obstacle.zLayers
          ? { zLayers: firstMember.obstacle.zLayers.slice() }
          : {}),
        ...(firstMember.obstacle.netIsAssignable
          ? { netIsAssignable: true }
          : {}),
        ...(offBoardConnectsTo.length > 0 ? { offBoardConnectsTo } : {}),
      }

      return {
        rootConnectionName: firstMember.rootConnectionName,
        inputIndexes: members
          .map((member) => member.inputIndex)
          .sort((a, b) => a - b),
        mergedObstacle,
      }
    })
  }

  private createConsolidatedSimpleRouteJson(): SimpleRouteJson {
    const connMap = getConnectivityMapFromSimpleRouteJson(this.inputSrj)
    const idToRootConnectionName = this.buildIdToRootConnectionNameMap()
    const netToRootConnectionNames = new Map<string, string[]>()
    const groupedObstacles = new Map<string, IndexedObstacle[]>()

    for (
      let obstacleIndex = 0;
      obstacleIndex < this.inputSrj.obstacles.length;
      obstacleIndex++
    ) {
      const obstacle = this.inputSrj.obstacles[
        obstacleIndex
      ] as ObstacleWithRuntimeType
      if ((obstacle.type ?? "rect") !== "rect") continue
      if (obstacle.isCopperPour) continue

      const rootConnectionNames = this.resolveRootConnectionNamesForObstacle(
        obstacle,
        idToRootConnectionName,
        netToRootConnectionNames,
        connMap,
      )

      if (rootConnectionNames.length !== 1) continue

      const rootConnectionName = rootConnectionNames[0]!
      const mergeGroupKey = this.getMergeGroupKey(obstacle, rootConnectionName)
      const mergeGroup = groupedObstacles.get(mergeGroupKey)
      const indexedObstacle: IndexedObstacle = {
        inputIndex: obstacleIndex,
        obstacle,
        rootConnectionName,
      }

      if (mergeGroup) {
        mergeGroup.push(indexedObstacle)
      } else {
        groupedObstacles.set(mergeGroupKey, [indexedObstacle])
      }
    }

    const replacementObstaclesByIndex = new Map<number, Obstacle>()
    const skippedIndexes = new Set<number>()
    this.mergedComponents = []

    for (const indexedObstacles of groupedObstacles.values()) {
      const mergeComponents = this.buildMergeComponents(indexedObstacles)
      this.mergedComponents.push(
        ...mergeComponents.filter(
          (component) => component.inputIndexes.length > 1,
        ),
      )

      for (const mergeComponent of mergeComponents) {
        const [firstInputIndex, ...remainingIndexes] =
          mergeComponent.inputIndexes
        replacementObstaclesByIndex.set(
          firstInputIndex!,
          mergeComponent.mergedObstacle,
        )
        for (const remainingIndex of remainingIndexes) {
          skippedIndexes.add(remainingIndex)
        }
      }
    }

    const outputObstacles: Obstacle[] = []
    for (
      let obstacleIndex = 0;
      obstacleIndex < this.inputSrj.obstacles.length;
      obstacleIndex++
    ) {
      if (skippedIndexes.has(obstacleIndex)) continue

      const replacementObstacle = replacementObstaclesByIndex.get(obstacleIndex)
      if (replacementObstacle) {
        outputObstacles.push(replacementObstacle)
      } else {
        outputObstacles.push(
          structuredClone(this.inputSrj.obstacles[obstacleIndex]!) as Obstacle,
        )
      }
    }

    this.stats.inputObstacleCount = this.inputSrj.obstacles.length
    this.stats.outputObstacleCount = outputObstacles.length
    this.stats.reducedObstacleCount =
      this.inputSrj.obstacles.length - outputObstacles.length
    this.stats.mergedComponentCount = this.mergedComponents.length
    this.stats.mergedInputObstacleCount = this.mergedComponents.reduce(
      (total, component) => total + component.inputIndexes.length,
      0,
    )
    this.stats.maxMergeGap = this.maxMergeGap
    this.stats.maxAreaInflation = this.maxAreaInflation

    return {
      ...this.inputSrj,
      obstacles: outputObstacles,
    }
  }

  visualize() {
    const originalRects = this.inputSrj.obstacles
      .filter(
        (obstacle) =>
          ((obstacle as ObstacleWithRuntimeType).type ?? "rect") === "rect",
      )
      .map((obstacle) => ({
        ...obstacle,
        fill: "rgba(0, 0, 0, 0.08)",
        stroke: "rgba(0, 0, 0, 0.18)",
      }))
    const mergedRects = this.mergedComponents.map((component) => ({
      ...component.mergedObstacle,
      fill: "rgba(0, 170, 255, 0.18)",
      stroke: "rgba(0, 170, 255, 0.95)",
      label: `${component.rootConnectionName} (${component.inputIndexes.length})`,
    }))

    return {
      rects: [...originalRects, ...mergedRects],
    }
  }
}
