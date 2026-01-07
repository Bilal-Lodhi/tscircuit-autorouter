import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import { SimpleRouteJson, Obstacle } from "lib/types"
import RBush from "rbush"

interface ObstacleExpansionSolverParams {
  simpleRouteJson: SimpleRouteJson
  minimumClearance: number
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Side = "left" | "right" | "top" | "bottom"
type ExpansionState = Record<Side, number>
type TreeNode = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  data: { index: number }
}
type ExpansionTask = { index: number; side: Side }

export class ObstacleExpansionSolver extends BaseSolver {
  expandedSimpleRouteJson: SimpleRouteJson
  private initialized = false
  private baseBoundsList: Bounds[] = []
  private layerSets: Array<Set<string>> = []
  private neighborMap: number[][] = []
  private expansionsByObstacle: ExpansionState[] = []
  private expandedBoundsList: Bounds[] = []
  private expansionQueue: ExpansionTask[] = []

  constructor(private params: ObstacleExpansionSolverParams) {
    super()
    this.MAX_ITERATIONS = Number.MAX_SAFE_INTEGER
    this.expandedSimpleRouteJson = {
      ...params.simpleRouteJson,
      obstacles: params.simpleRouteJson.obstacles.map((obstacle) => ({
        ...obstacle,
      })),
    }
  }

  _step() {
    if (!this.initialized) {
      this.initializeState()
    }
    if (this.solved) {
      return
    }
    if (this.expansionQueue.length === 0) {
      this.finalizeExpansion()
      return
    }
    const task = this.expansionQueue.shift()
    if (!task) {
      this.finalizeExpansion()
      return
    }
    this.expandSide({ index: task.index, side: task.side })
  }

  private initializeState() {
    const { simpleRouteJson, minimumClearance } = this.params
    const { obstacles } = simpleRouteJson
    this.baseBoundsList = obstacles.map((obstacle) =>
      this.getBounds({ obstacle }),
    )
    this.layerSets = obstacles.map((obstacle) => new Set(obstacle.layers))
    this.expandedBoundsList = this.baseBoundsList.map((bounds) => ({
      ...bounds,
    }))
    this.expansionsByObstacle = obstacles.map(() => ({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    }))
    const tree = new RBush<TreeNode>()
    if (obstacles.length > 0) {
      tree.load(
        this.baseBoundsList.map((bounds, index) => ({
          ...bounds,
          data: { index },
        })),
      )
    }
    this.neighborMap = this.buildNeighborMap({
      baseBoundsList: this.baseBoundsList,
      layerSets: this.layerSets,
      tree,
      minimumClearance,
    })
    this.expansionQueue = this.buildExpansionQueue({ obstacles })
    this.initialized = true
  }

  private buildExpansionQueue({
    obstacles,
  }: {
    obstacles: Obstacle[]
  }) {
    const sides: Side[] = ["left", "right", "bottom", "top"]
    const order = obstacles
      .map((obstacle, index) => ({
        index,
        area: obstacle.width * obstacle.height,
      }))
      .sort((a, b) => {
        if (a.area === b.area) {
          return a.index - b.index
        }
        return a.area - b.area
      })
    const queue: ExpansionTask[] = []
    for (const entry of order) {
      for (const side of sides) {
        queue.push({ index: entry.index, side })
      }
    }
    return queue
  }

  private expandSide({ index, side }: ExpansionTask) {
    const baseBounds = this.baseBoundsList[index]
    const expansions = this.expansionsByObstacle[index]
    const neighborIndexes = this.neighborMap[index]
    if (!baseBounds || !expansions || !neighborIndexes) {
      return
    }
    const remaining = Math.max(
      0,
      this.params.minimumClearance - expansions[side],
    )
    if (remaining <= 0) {
      return
    }
    const currentBounds = this.applyExpansions({
      baseBounds,
      expansions,
    })
    const distance = this.calculateExpansionDistance({
      side,
      maxDistance: remaining,
      currentBounds,
      neighborIndexes,
      baseBoundsList: this.baseBoundsList,
      expandedBoundsList: this.expandedBoundsList,
    })
    if (distance <= 0) {
      return
    }
    expansions[side] += distance
    this.updateBoundsForObstacle({
      index,
      baseBounds,
      expansions,
    })
  }

  private updateBoundsForObstacle({
    index,
    baseBounds,
    expansions,
  }: {
    index: number
    baseBounds: Bounds
    expansions: ExpansionState
  }) {
    const bounds = this.applyExpansions({
      baseBounds,
      expansions,
    })
    this.expandedBoundsList[index] = bounds
    const existing =
      this.expandedSimpleRouteJson.obstacles[index] ??
      this.params.simpleRouteJson.obstacles[index]
    if (!existing) {
      return
    }
    this.expandedSimpleRouteJson.obstacles[index] = {
      ...existing,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
    }
  }

  private finalizeExpansion() {
    const { simpleRouteJson } = this.params
    const obstacles = simpleRouteJson.obstacles.map((obstacle, index) => {
      const bounds =
        this.expandedBoundsList[index] ?? this.getBounds({ obstacle })
      return {
        ...obstacle,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
      }
    })
    this.expandedSimpleRouteJson = {
      ...this.expandedSimpleRouteJson,
      obstacles,
    }
    this.solved = true
  }

  private calculateExpansionDistance({
    side,
    maxDistance,
    currentBounds,
    neighborIndexes,
    baseBoundsList,
    expandedBoundsList,
  }: {
    side: Side
    maxDistance: number
    currentBounds: Bounds
    neighborIndexes: number[]
    baseBoundsList: Bounds[]
    expandedBoundsList: Bounds[]
  }) {
    if (maxDistance <= 0) {
      return 0
    }
    let limit = maxDistance
    for (const neighborIndex of neighborIndexes) {
      const neighborBounds =
        expandedBoundsList[neighborIndex] ?? baseBoundsList[neighborIndex]
      if (!neighborBounds) continue
      if (
        !this.intervalsOverlap({
          minA: currentBounds.minY,
          maxA: currentBounds.maxY,
          minB: neighborBounds.minY,
          maxB: neighborBounds.maxY,
        })
      ) {
        continue
      }
      const overlapsHorizontally =
        neighborBounds.minX < currentBounds.maxX &&
        neighborBounds.maxX > currentBounds.minX
      if (overlapsHorizontally) {
        return 0
      }
      if (side === "left") {
        if (neighborBounds.maxX <= currentBounds.minX) {
          const gap = currentBounds.minX - neighborBounds.maxX
          limit = Math.min(limit, gap)
        }
      } else if (side === "right") {
        if (neighborBounds.minX >= currentBounds.maxX) {
          const gap = neighborBounds.minX - currentBounds.maxX
          limit = Math.min(limit, gap)
        }
      } else if (side === "top") {
        if (neighborBounds.minY >= currentBounds.maxY) {
          const gap = neighborBounds.minY - currentBounds.maxY
          limit = Math.min(limit, gap)
        }
      } else if (side === "bottom") {
        if (neighborBounds.maxY <= currentBounds.minY) {
          const gap = currentBounds.minY - neighborBounds.maxY
          limit = Math.min(limit, gap)
        }
      }
    }
    return Math.max(0, limit)
  }

  private intervalsOverlap({
    minA,
    maxA,
    minB,
    maxB,
  }: {
    minA: number
    maxA: number
    minB: number
    maxB: number
  }) {
    return maxA > minB && maxB > minA
  }

  private applyExpansions({
    baseBounds,
    expansions,
  }: {
    baseBounds: Bounds
    expansions: ExpansionState
  }) {
    return {
      minX: baseBounds.minX - expansions.left,
      maxX: baseBounds.maxX + expansions.right,
      minY: baseBounds.minY - expansions.bottom,
      maxY: baseBounds.maxY + expansions.top,
    }
  }

  private buildNeighborMap({
    baseBoundsList,
    layerSets,
    tree,
    minimumClearance,
  }: {
    baseBoundsList: Bounds[]
    layerSets: Array<Set<string>>
    tree: RBush<TreeNode>
    minimumClearance: number
  }) {
    const neighborMap: number[][] = baseBoundsList.map(() => [])
    const padding: ExpansionState = {
      left: minimumClearance * 2,
      right: minimumClearance * 2,
      top: minimumClearance * 2,
      bottom: minimumClearance * 2,
    }
    for (let index = 0; index < baseBoundsList.length; index++) {
      const bounds = baseBoundsList[index]
      const searchBounds = this.applyExpansions({
        baseBounds: bounds,
        expansions: padding,
      })
      const hits = tree.search(searchBounds)
      const neighbors: number[] = []
      for (const hit of hits) {
        const neighborIndex = hit.data.index
        if (neighborIndex === index) continue
        if (
          !this.layerSetOverlap({
            setA: layerSets[index],
            setB: layerSets[neighborIndex],
          })
        ) {
          continue
        }
        neighbors.push(neighborIndex)
      }
      neighborMap[index] = neighbors
    }
    return neighborMap
  }

  private layerSetOverlap({
    setA,
    setB,
  }: {
    setA: Set<string>
    setB: Set<string>
  }) {
    for (const layer of setA) {
      if (setB.has(layer)) {
        return true
      }
    }
    return false
  }

  private getBounds({ obstacle }: { obstacle: Obstacle }): Bounds {
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    return {
      minX: obstacle.center.x - halfWidth,
      maxX: obstacle.center.x + halfWidth,
      minY: obstacle.center.y - halfHeight,
      maxY: obstacle.center.y + halfHeight,
    }
  }

  getOutput() {
    return this.expandedSimpleRouteJson
  }

  visualize(): GraphicsObject {
    const original = this.params.simpleRouteJson.obstacles
    const expanded = this.expandedSimpleRouteJson.obstacles
    const rects = original.flatMap((obstacle, index) => {
      const expandedObstacle = expanded[index] ?? obstacle
      const baseRect = {
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        layer: obstacle.layers.join(","),
        fill: "rgba(255, 105, 97, 0.15)",
        stroke: "rgba(255, 105, 97, 0.6)",
        label: obstacle.obstacleId
          ? `${obstacle.obstacleId} (base)`
          : `obstacle ${index} (base)`,
      }
      const expandedRect = {
        center: expandedObstacle.center,
        width: expandedObstacle.width,
        height: expandedObstacle.height,
        layer: expandedObstacle.layers.join(","),
        fill: "rgba(0, 122, 255, 0.15)",
        stroke: "rgba(0, 122, 255, 0.6)",
        label: expandedObstacle.obstacleId
          ? `${expandedObstacle.obstacleId} (expanded)`
          : `obstacle ${index} (expanded)`,
      }
      return [baseRect, expandedRect]
    })

    return {
      title: "Obstacle Expansion",
      coordinateSystem: "cartesian",
      rects,
      lines: [],
      points: [],
      circles: [],
    }
  }
}
