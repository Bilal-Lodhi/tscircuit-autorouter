import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { areAllRegionPortsBlocked } from "../areAllRegionPortsBlocked"
import { depthLimitedBfs } from "../depthLimitedBfsSolver"
import { HopCheckSolverInput, TypedRegion, TypedRegionPort } from "../types"
import { candidateToPath } from "../candidateToPath"
import { selectBestCandidate } from "../selectBestCandidate"

type FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolverInput =
  HopCheckSolverInput & {
    regionsWithObstacle: TypedRegion[]
  }

/**
 * Finds cramped port points that can potentially make unreachable obstacle regions reachable.
 */
export class FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver extends BaseSolver {
  private regionsWithObstacleQueue: TypedRegion[]
  private currentRegionWithObstacle: TypedRegion | undefined
  private bestPath: TypedRegionPort[] = []
  override getSolverName(): string {
    return "findCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolver"
  }

  constructor(
    private input: FindCrampedPortPointsToMakeUnreachableRegionsContainingObstacleReachableSolverInput,
  ) {
    super()
    this.regionsWithObstacleQueue = [...this.input.regionsWithObstacle]
  }

  step(): void {
    if (this.regionsWithObstacleQueue.length === 0) {
      this.solved = true
      return
    }
    this.currentRegionWithObstacle = this.regionsWithObstacleQueue.shift()!
    const {
      portPointsAtNthDegree,
      outputCandidatesAtNthDegreeWithoutObstacleShare:
        outputCandidatesAtNthDegree,
    } = depthLimitedBfs({
      depthLimit: 2,
      targetRegion: this.currentRegionWithObstacle,
      shouldIgnoreCrampedPortPoints: false,
    })
    if (areAllRegionPortsBlocked(portPointsAtNthDegree)) {
      this.failed = true
      this.error = `Region ${this.currentRegionWithObstacle.regionId} is unreachable even after considering cramped port points`
      return
    }
    if (outputCandidatesAtNthDegree.length === 0) {
      this.failed = true
      this.error = `Region ${this.currentRegionWithObstacle.regionId} has no valid candidate path after obstacle-sharing filter`
      return
    }
    this.bestPath = [
      ...this.bestPath,
      ...candidateToPath(selectBestCandidate(outputCandidatesAtNthDegree)),
    ]
  }

  getOutput(): TypedRegionPort[] {
    return this.bestPath
  }

  visualize(): GraphicsObject {
    let graphics: GraphicsObject = {
      rects: [],
      points: [],
    }

    for (const region of this.input.regionsWithObstacle) {
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

    for (const visited of this.bestPath) {
      if (!visited.d.cramped) {
        graphics.points?.push({
          ...visited.d,
          color: "green",
          layer: `availableZ=${visited.d.availableZ}`,
          label: `${visited.portId}`,
        })
      } else {
        graphics.rects?.push({
          ...visited.d,
          center: {
            x: visited.d.x,
            y: visited.d.y,
          },
          width: 0.1,
          height: 0.1,
          fill: "green",
          layer: `availableZ=${visited.d.availableZ}`,
          label: `${visited.portId}`,
        })
      }
    }

    return graphics
  }
}
