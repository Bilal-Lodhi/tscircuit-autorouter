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
    const baseBounds: Bounds[] = new Array(obstacles.length)
    const expandedBounds: Bounds[] = new Array(obstacles.length)
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i]
      const halfWidth = obstacle.width / 2
      const halfHeight = obstacle.height / 2
      const bounds = {
        minX: obstacle.center.x - halfWidth,
        maxX: obstacle.center.x + halfWidth,
        minY: obstacle.center.y - halfHeight,
        maxY: obstacle.center.y + halfHeight,
      }
      baseBounds[i] = bounds
      expandedBounds[i] = { ...bounds }
    }
    this.baseBoundsList = baseBounds
    this.layerSets = obstacles.map((obstacle) => new Set(obstacle.layers))
    this.expandedBoundsList = expandedBounds
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
    let remaining = this.params.minimumClearance - expansions[side]
    if (remaining <= 0) {
      return
    }
    const currentBounds = this.expandedBoundsList[index] ?? baseBounds
    const minY = currentBounds.minY
    const maxY = currentBounds.maxY
    const minX = currentBounds.minX
    const maxX = currentBounds.maxX
    for (const neighborIndex of neighborIndexes) {
      const neighborBounds =
        this.expandedBoundsList[neighborIndex] ??
        this.baseBoundsList[neighborIndex]
      if (!neighborBounds) continue

      if (side === "left" || side === "right") {
        if (neighborBounds.maxY <= minY || neighborBounds.minY >= maxY) continue
        if (neighborBounds.minX < maxX && neighborBounds.maxX > minX) return
      } else {
        if (neighborBounds.maxX <= minX || neighborBounds.minX >= maxX) continue
        if (neighborBounds.minY < maxY && neighborBounds.maxY > minY) return
      }

      if (side === "left") {
        if (neighborBounds.maxX <= minX) {
          const gap = minX - neighborBounds.maxX
          if (gap < remaining) remaining = gap
        }
      } else if (side === "right") {
        if (neighborBounds.minX >= maxX) {
          const gap = neighborBounds.minX - maxX
          if (gap < remaining) remaining = gap
        }
      } else if (side === "top") {
        if (neighborBounds.minY >= maxY) {
          const gap = neighborBounds.minY - maxY
          if (gap < remaining) remaining = gap
        }
      } else if (side === "bottom") {
        if (neighborBounds.maxY <= minY) {
          const gap = minY - neighborBounds.maxY
          if (gap < remaining) remaining = gap
        }
      }
    }
    if (remaining <= 0) {
      return
    }
    expansions[side] += remaining
    const bounds = {
      minX: baseBounds.minX - expansions.left,
      maxX: baseBounds.maxX + expansions.right,
      minY: baseBounds.minY - expansions.bottom,
      maxY: baseBounds.maxY + expansions.top,
    }
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
      const bounds = this.expandedBoundsList[index] ?? {
        minX: obstacle.center.x - obstacle.width / 2,
        maxX: obstacle.center.x + obstacle.width / 2,
        minY: obstacle.center.y - obstacle.height / 2,
        maxY: obstacle.center.y + obstacle.height / 2,
      }
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
    const padding = minimumClearance * 2
    for (let index = 0; index < baseBoundsList.length; index++) {
      const bounds = baseBoundsList[index]
      if (!bounds) continue
      const searchBounds = {
        minX: bounds.minX - padding,
        maxX: bounds.maxX + padding,
        minY: bounds.minY - padding,
        maxY: bounds.maxY + padding,
      }
      const hits = tree.search(searchBounds)
      const neighbors: number[] = []
      const layers = layerSets[index]
      for (const hit of hits) {
        const neighborIndex = hit.data.index
        if (neighborIndex === index) continue
        const otherSet = layerSets[neighborIndex]
        if (!layers || !otherSet) continue
        let overlap = false
        for (const layer of layers) {
          if (otherSet.has(layer)) {
            overlap = true
            break
          }
        }
        if (!overlap) {
          continue
        }
        neighbors.push(neighborIndex)
      }
      neighborMap[index] = neighbors
    }
    return neighborMap
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
