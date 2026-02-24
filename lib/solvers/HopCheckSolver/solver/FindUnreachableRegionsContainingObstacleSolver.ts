import { Region } from "@tscircuit/hypergraph"
import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { areAllRegionPortsBlocked } from "../areAllRegionPortsBlocked"
import { depthLimitedBfs } from "../depthLimitedBfsSolver"
import { TypedRegion, TypedRegionPort, HopCheckSolverInput } from "../types"

/**
 * This solver identifies regions that contain obstacles and are unreachable
 * (i.e., all their port points are blocked)
 * It performs a breadth-first search (BFS) with a depth limit of 2 to check the reachability of each
 * region containing an obstacle. The output is a list of regions that are deemed unreachable under these conditions.
 *
 * NOTE: This solution has flaws in case the disconnect happens beyond the
 * 2nd degree neighbors. It will fail to identify those regions.
 */
export class FindUnreachableRegionsContainingObstacleSolver extends BaseSolver {
  regionsWithObstacleQueue: TypedRegion[]
  private currentRegionWithObstacle: TypedRegion | undefined
  private outputPortOfBfs: TypedRegionPort[] = []
  private allRegionWithObstacle: TypedRegion[]
  private unreachableRegionsContainingObstacle: TypedRegion[] = []

  override getSolverName(): string {
    return "findUnreachableRegionsContainingObstacleSolver"
  }

  constructor(private input: HopCheckSolverInput) {
    super()
    this.regionsWithObstacleQueue = input.graph.regions.filter(
      (region) => region.d._containsObstacle,
    )
    this.allRegionWithObstacle = input.graph.regions.filter(
      (region) => region.d._containsObstacle,
    )
    this.regionsWithObstacleQueue.sort((a, b) => a.d.center.x - b.d.center.x)
  }

  step(): void {
    this.currentRegionWithObstacle = this.regionsWithObstacleQueue.shift()
    if (!this.currentRegionWithObstacle) {
      this.solved = true
      return
    }
    const { portPointsAtNthDegree } = depthLimitedBfs({
      depthLimit: 2,
      targetRegion: this.currentRegionWithObstacle,
      shouldIgnoreCrampedPortPoints: true,
    })
    this.outputPortOfBfs = portPointsAtNthDegree

    if (areAllRegionPortsBlocked(this.outputPortOfBfs)) {
      this.unreachableRegionsContainingObstacle.push(
        this.currentRegionWithObstacle,
      )
    }
  }

  getOutput(): Region[] {
    return this.unreachableRegionsContainingObstacle
  }

  visualize(): GraphicsObject {
    let graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    if (!this.currentRegionWithObstacle) {
      for (const region of this.allRegionWithObstacle) {
        graphics.rects?.push({
          ...region.d,
          fill: "rgb(255, 0, 0, 0.5)",
          layer: `availableZ=${region.d.availableZ}`,
          label: `${region.regionId}`,
        })
      }
      return graphics
    }

    for (const region of this.allRegionWithObstacle) {
      graphics.rects?.push({
        ...region.d,
        fill:
          this.currentRegionWithObstacle === region
            ? "rgb(255, 0, 0, 0.5)"
            : "rgb(255, 0, 0, 0.2)",
        layer: `availableZ=${region.d.availableZ}`,
        label: `${region.regionId}`,
      })
    }

    for (const region of this.unreachableRegionsContainingObstacle) {
      graphics.rects?.push({
        ...region.d,
        fill: "rgb(0, 0, 255, 0.5)",
        layer: `availableZ=${region.d.availableZ}`,
        label: `${region.regionId} (unreachable)`,
      })
    }

    for (const port of this.outputPortOfBfs) {
      graphics.points?.push({
        ...port.d,
        color: "green",
        layer: `availableZ=${port.d.availableZ}`,
        label: `${port.portId}`,
      })
    }

    return graphics
  }
}
