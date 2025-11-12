import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { BaseSolver } from "../BaseSolver"

interface MinimalMergeCollisionSolverParams {
  nodes: CapacityMeshNode[]
}

const COLLISION_FLAGS = ["_collision", "_isCollision", "isCollision"] as const

export class MinimalMergeCollisionSolver extends BaseSolver {
  private readonly inputNodes: CapacityMeshNode[]
  newNodes: CapacityMeshNode[]
  private nodeIdCounter = 0

  constructor(params: MinimalMergeCollisionSolverParams) {
    super()
    this.MAX_ITERATIONS = 1
    this.inputNodes = params.nodes.map((node) => ({
      ...node,
      center: { ...node.center },
    }))
    this.newNodes = []
  }

  private isCollisionNode(node: CapacityMeshNode): boolean {
    const explicitCollisionFlag = COLLISION_FLAGS.some(
      (flag) => (node as any)[flag],
    )
    const overlapsObstacle = Boolean(
      node._containsObstacle || node._completelyInsideObstacle,
    )
    const hasTarget = Boolean(node._containsTarget)

    return (explicitCollisionFlag || overlapsObstacle) && !hasTarget
  }

  private generateNodeId(): string {
    return `mmc_${this.nodeIdCounter++}`
  }

  private mergeCollisionGroup(group: CapacityMeshNode[]): CapacityMeshNode {
    const first = group[0]
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    const allAvailableZ = new Set<number>()
    let containsObstacle = false
    let containsTarget = false
    let targetConnectionName: string | undefined
    let depth = Infinity
    let completelyInsideObstacle = false

    for (const node of group) {
      const halfWidth = node.width / 2
      const halfHeight = node.height / 2
      minX = Math.min(minX, node.center.x - halfWidth)
      maxX = Math.max(maxX, node.center.x + halfWidth)
      minY = Math.min(minY, node.center.y - halfHeight)
      maxY = Math.max(maxY, node.center.y + halfHeight)

      node.availableZ.forEach((z) => allAvailableZ.add(z))
      containsObstacle = containsObstacle || Boolean(node._containsObstacle)
      completelyInsideObstacle =
        completelyInsideObstacle || Boolean(node._completelyInsideObstacle)
      if (node._containsTarget) {
        containsTarget = true
        targetConnectionName = node._targetConnectionName
      }
      if (typeof node._depth === "number") {
        depth = Math.min(depth, node._depth)
      }
    }

    const mergedNode: CapacityMeshNode = {
      capacityMeshNodeId: this.generateNodeId(),
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      layer: first.layer,
      availableZ: Array.from(allAvailableZ).sort((a, b) => a - b),
    }

    if (depth !== Infinity) {
      mergedNode._depth = depth
    }
    if (containsObstacle) {
      mergedNode._containsObstacle = true
    }
    if (completelyInsideObstacle) {
      mergedNode._completelyInsideObstacle = true
    }
    if (containsTarget) {
      mergedNode._containsTarget = true
      mergedNode._targetConnectionName = targetConnectionName
    }
    ;(mergedNode as any)._mergedCollisionNodeIds = group.map(
      (node) => node.capacityMeshNodeId,
    )

    return mergedNode
  }

  _step() {
    if (this.solved) return

    const collisionGroups = new Map<string, CapacityMeshNode[]>()
    const passthroughNodes: CapacityMeshNode[] = []

    for (const node of this.inputNodes) {
      if (!this.isCollisionNode(node)) {
        passthroughNodes.push(node)
        continue
      }
      const key = `${node.layer}|${node.availableZ
        .slice()
        .sort((a, b) => a - b)
        .join(",")}`
      const group = collisionGroups.get(key)
      if (group) {
        group.push(node)
      } else {
        collisionGroups.set(key, [node])
      }
    }

    const mergedNodes: CapacityMeshNode[] = []
    for (const [, group] of collisionGroups) {
      if (group.length === 1) {
        mergedNodes.push(group[0]!)
        continue
      }
      mergedNodes.push(this.mergeCollisionGroup(group))
    }

    this.newNodes = [...passthroughNodes, ...mergedNodes]
    this.stats.mergedCollisionGroupCount = mergedNodes.filter((node) =>
      Boolean((node as any)._mergedCollisionNodeIds),
    ).length
    this.stats.collisionNodeCount = Array.from(collisionGroups.values()).reduce(
      (acc, group) => acc + group.length,
      0,
    )

    this.solved = true
  }

  visualize(): GraphicsObject {
    const rects: GraphicsObject["rects"] = []

    for (const node of this.inputNodes) {
      const isCollision = this.isCollisionNode(node)
      rects?.push({
        center: node.center,
        width: node.width,
        height: node.height,
        stroke: isCollision ? "rgba(255,0,0,0.65)" : "rgba(0,0,0,0.25)",
        fill: isCollision ? "rgba(255,0,0,0.15)" : "rgba(0,0,0,0.05)",
        layer: `z${node.availableZ.join(",")}`,
        label: `${node.capacityMeshNodeId}${isCollision ? "\ncollision" : ""}`,
      })
    }

    for (const node of this.newNodes) {
      rects?.push({
        center: node.center,
        width: node.width,
        height: node.height,
        stroke: "rgba(0,128,255,0.7)",
        fill: "rgba(0,128,255,0.15)",
        layer: `z${node.availableZ.join(",")}`,
        label: `${node.capacityMeshNodeId}\nmerged`,
      })
    }

    return {
      rects,
      lines: [],
      points: [],
      circles: [],
      title: "Minimal Merge Collision Solver",
    }
  }
}
