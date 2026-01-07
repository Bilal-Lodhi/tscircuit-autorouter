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

export class ObstacleExpansionSolver extends BaseSolver {
  expandedSimpleRouteJson: SimpleRouteJson

  constructor(private params: ObstacleExpansionSolverParams) {
    super()
    this.MAX_ITERATIONS = 1
    this.expandedSimpleRouteJson = { ...params.simpleRouteJson }
  }

  _step() {
    const { simpleRouteJson, minimumClearance } = this.params
    const originalTree = new RBush<TreeNode>()
    const obstacles = simpleRouteJson.obstacles
    const baseBoundsList = obstacles.map((obstacle) =>
      this.getBounds({ obstacle }),
    )
    const layerSets = obstacles.map((obstacle) => new Set(obstacle.layers))
    const expandedBoundsList: Array<Bounds | null> = obstacles.map(() => null)

    if (obstacles.length > 0) {
      originalTree.load(
        baseBoundsList.map((bounds, index) => ({
          ...bounds,
          data: { index },
        })),
      )
    }

    const neighborMap = this.buildNeighborMap({
      baseBoundsList,
      layerSets,
      tree: originalTree,
      minimumClearance,
    })

    const obstacleOrder = obstacles
      .map((obstacle, index) => ({
        obstacle,
        index,
        area: obstacle.width * obstacle.height,
      }))
      .sort((a, b) => {
        if (a.area === b.area) {
          return a.index - b.index
        }
        return a.area - b.area
      })

    const expandedObstacles = [...obstacles]

    for (const { obstacle, index } of obstacleOrder) {
      const expanded = this.expandObstacle({
        obstacle,
        minimumClearance,
        baseBounds: baseBoundsList[index],
        baseBoundsList,
        expandedBoundsList,
        neighborIndexes: neighborMap[index],
      })
      expandedObstacles[index] = expanded
      expandedBoundsList[index] = this.getBounds({ obstacle: expanded })
    }

    this.expandedSimpleRouteJson = {
      ...simpleRouteJson,
      obstacles: expandedObstacles,
    }
    this.solved = true
  }

  private expandObstacle({
    obstacle,
    minimumClearance,
    baseBounds,
    baseBoundsList,
    expandedBoundsList,
    neighborIndexes,
  }: {
    obstacle: Obstacle
    minimumClearance: number
    baseBounds: Bounds
    baseBoundsList: Bounds[]
    expandedBoundsList: Array<Bounds | null>
    neighborIndexes: number[]
  }) {
    const expansions: ExpansionState = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    }
    const sides: Side[] = ["left", "right", "bottom", "top"]
    for (const side of sides) {
      const currentBounds = this.applyExpansions({ baseBounds, expansions })
      const distance = this.calculateExpansionDistance({
        side,
        maxDistance: minimumClearance,
        currentBounds,
        neighborIndexes,
        baseBoundsList,
        expandedBoundsList,
      })
      expansions[side] += distance
    }
    const bounds = this.applyExpansions({ baseBounds, expansions })
    return {
      ...obstacle,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
    }
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
    expandedBoundsList: Array<Bounds | null>
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
