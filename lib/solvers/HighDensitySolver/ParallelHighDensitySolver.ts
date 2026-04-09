import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { BaseSolver, type PendingEffect } from "../BaseSolver"
import { safeTransparentize } from "../colors"
import { HighDensitySolver } from "./HighDensitySolver"
import type {
  ParallelHighDensityWorkerResult,
  ParallelHighDensityWorkerTask,
} from "./ParallelHighDensitySolver.workerTypes"
import { serializeConnectivityMapForConnectionNames } from "./serializedConnectivityMap"

type NodeSolveMetadata = {
  node: NodeWithPortPoints
  status: "solved" | "failed"
  solverType: string
  supervisorType: string
  iterations: number
  routeCount: number
  nodePf: number | null
  error?: string
}

type QueuedTask = {
  task: ParallelHighDensityWorkerTask
  resolve: (value: ParallelHighDensityWorkerResult) => void
  reject: (reason?: unknown) => void
}

type WorkerSlot = {
  id: number
  worker: Worker
  activeTask: QueuedTask | null
}

class ParallelHighDensityWorkerPool {
  private readonly workerUrl = new URL(
    "./ParallelHighDensitySolver.worker.ts",
    import.meta.url,
  )
  private readonly workers: WorkerSlot[]
  private readonly queuedTasks: QueuedTask[] = []
  private closed = false

  constructor(workerCount: number) {
    this.workers = Array.from({ length: workerCount }, (_, index) =>
      this.createWorkerSlot(index),
    )
  }

  runTask(task: ParallelHighDensityWorkerTask) {
    return new Promise<ParallelHighDensityWorkerResult>((resolve, reject) => {
      this.queuedTasks.push({ task, resolve, reject })
      this.dispatch()
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.queuedTasks
      .splice(0)
      .forEach((queuedTask) =>
        queuedTask.reject(new Error("ParallelHighDensityWorkerPool closed")),
      )
    await Promise.all(
      this.workers.map((slot) => Promise.resolve(slot.worker.terminate())),
    )
  }

  private createWorkerSlot(id: number): WorkerSlot {
    const slot: WorkerSlot = {
      id,
      worker: this.createWorker(id),
      activeTask: null,
    }

    this.attachWorkerListeners(slot)
    return slot
  }

  private createWorker(id: number) {
    return new Worker(this.workerUrl, {
      type: "module",
      name: `parallel-high-density-${id}`,
    })
  }

  private attachWorkerListeners(slot: WorkerSlot) {
    slot.worker.addEventListener("message", (event) => {
      const activeTask = slot.activeTask
      slot.activeTask = null

      if (!activeTask) {
        return
      }

      activeTask.resolve(event.data as ParallelHighDensityWorkerResult)
      this.dispatch()
    })

    slot.worker.addEventListener("error", (event) => {
      const activeTask = slot.activeTask
      slot.activeTask = null

      if (activeTask) {
        activeTask.reject(
          event.error ??
            new Error(
              event.message ||
                `parallel high-density worker ${slot.id} failed unexpectedly`,
            ),
        )
      }

      if (!this.closed) {
        slot.worker.terminate()
        slot.worker = this.createWorker(slot.id)
        this.attachWorkerListeners(slot)
        this.dispatch()
      }
    })
  }

  private dispatch() {
    if (this.closed) return

    for (const slot of this.workers) {
      if (slot.activeTask || this.queuedTasks.length === 0) {
        continue
      }

      const queuedTask = this.queuedTasks.shift()!
      slot.activeTask = queuedTask
      slot.worker.postMessage(queuedTask.task)
    }
  }
}

export class ParallelHighDensitySolver extends BaseSolver {
  override getSolverName(): string {
    return "ParallelHighDensitySolver"
  }

  readonly unsolvedNodePortPoints: NodeWithPortPoints[]
  readonly colorMap: Record<string, string>
  readonly connMap?: ConnectivityMap
  readonly viaDiameter: number
  readonly traceWidth: number
  readonly obstacleMargin: number
  readonly effort: number
  readonly nodePfById: Map<CapacityMeshNodeId, number | null>
  readonly workerCount: number
  readonly useWorkerPool: boolean

  routes: HighDensityIntraNodeRoute[] = []
  nodeSolveMetadataById = new Map<CapacityMeshNodeId, NodeSolveMetadata>()
  pendingEffects: PendingEffect[] = []

  private readonly fallbackSolver: HighDensitySolver | null
  private readonly solvedRoutesByNodeIndex = new Map<
    number,
    HighDensityIntraNodeRoute[]
  >()
  private readonly failedNodeResults: Array<{
    node: NodeWithPortPoints
    error: string
  }> = []
  private workerPool: ParallelHighDensityWorkerPool | null = null
  private launchedWorkerPool = false
  private nextTaskId = 1

  constructor({
    nodePortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    nodePfById,
    workerCount,
    useWorkerPool,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
    obstacleMargin?: number
    effort?: number
    nodePfById?:
      | Map<CapacityMeshNodeId, number | null>
      | Record<string, number | null>
    workerCount?: number
    useWorkerPool?: boolean
  }) {
    super()
    this.MAX_ITERATIONS = 100_000_000
    this.unsolvedNodePortPoints = nodePortPoints
    this.colorMap = colorMap ?? {}
    this.connMap = connMap
    this.viaDiameter = viaDiameter ?? 0.3
    this.traceWidth = traceWidth ?? 0.15
    this.obstacleMargin = obstacleMargin ?? 0.15
    this.effort = effort ?? 1
    this.workerCount = workerCount ?? 4
    this.useWorkerPool =
      useWorkerPool !== false && typeof Worker !== "undefined"
    this.nodePfById =
      nodePfById instanceof Map
        ? new Map(nodePfById)
        : new Map(Object.entries(nodePfById ?? {}))
    this.fallbackSolver = this.useWorkerPool
      ? null
      : new HighDensitySolver({
          nodePortPoints,
          colorMap,
          connMap,
          viaDiameter,
          traceWidth,
          obstacleMargin,
          effort,
          nodePfById,
        })
    this.stats = {
      solverNodeCount: {} as Record<string, number>,
      difficultNodePfs: {} as Record<string, number[]>,
      workerCount: this.useWorkerPool ? this.workerCount : 0,
      executionMode: this.useWorkerPool ? "worker-pool" : "local-fallback",
    }
  }

  computeProgress() {
    if (this.unsolvedNodePortPoints.length === 0) {
      return 1
    }

    if (this.fallbackSolver) {
      return this.fallbackSolver.progress
    }

    return this.nodeSolveMetadataById.size / this.unsolvedNodePortPoints.length
  }

  private recordSolvedNodeStats(metadata: NodeSolveMetadata) {
    const solverNodeCount = this.stats.solverNodeCount as Record<string, number>
    const difficultNodePfs = this.stats.difficultNodePfs as Record<
      string,
      number[]
    >

    solverNodeCount[metadata.solverType] =
      (solverNodeCount[metadata.solverType] ?? 0) + 1

    if (metadata.nodePf !== null && metadata.nodePf > 0.05) {
      if (!difficultNodePfs[metadata.solverType]) {
        difficultNodePfs[metadata.solverType] = []
      }
      difficultNodePfs[metadata.solverType].push(metadata.nodePf)
    }
  }

  private recordNodeSolveMetadata(
    node: NodeWithPortPoints,
    result: Omit<NodeSolveMetadata, "node" | "nodePf">,
  ) {
    const metadata: NodeSolveMetadata = {
      ...result,
      node,
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null,
    }

    this.nodeSolveMetadataById.set(node.capacityMeshNodeId, metadata)

    if (metadata.status === "solved") {
      this.recordSolvedNodeStats(metadata)
    }
  }

  private getWorkerTask(
    node: NodeWithPortPoints,
  ): Omit<ParallelHighDensityWorkerTask, "taskId"> {
    const connectionNames = node.portPoints.map((point) => point.connectionName)
    return {
      nodeWithPortPoints: node,
      colorMap: this.colorMap,
      serializedConnMap: serializeConnectivityMapForConnectionNames(
        this.connMap,
        connectionNames,
      ),
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
    }
  }

  private launchWorkerPool() {
    this.workerPool = new ParallelHighDensityWorkerPool(this.workerCount)

    const taskEffects = this.unsolvedNodePortPoints.map((node, nodeIndex) => {
      const pendingEffect: PendingEffect = {
        name: `parallel-hd-node:${node.capacityMeshNodeId}`,
        promise: Promise.resolve(),
      }

      pendingEffect.promise = this.workerPool!.runTask({
        taskId: this.nextTaskId++,
        ...this.getWorkerTask(node),
      })
        .then((result) => {
          if (!result.ok) {
            const errorMessage =
              result.error ??
              `Worker solve failed for ${node.capacityMeshNodeId}`
            this.failedNodeResults.push({
              node,
              error: errorMessage,
            })
            this.recordNodeSolveMetadata(node, {
              status: "failed",
              solverType: result.solverType,
              supervisorType: result.supervisorType,
              iterations: result.iterations,
              routeCount: 0,
              error: errorMessage,
            })
            return
          }

          this.solvedRoutesByNodeIndex.set(nodeIndex, result.solvedRoutes)
          this.recordNodeSolveMetadata(node, {
            status: "solved",
            solverType: result.solverType,
            supervisorType: result.supervisorType,
            iterations: result.iterations,
            routeCount: result.solvedRoutes.length,
          })
        })
        .catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          this.failedNodeResults.push({
            node,
            error: errorMessage,
          })
          this.recordNodeSolveMetadata(node, {
            status: "failed",
            solverType: "worker-error",
            supervisorType: "ParallelHighDensitySolver",
            iterations: 0,
            routeCount: 0,
            error: errorMessage,
          })
        })
        .finally(() => {
          this.pendingEffects = this.pendingEffects.filter(
            (effect) => effect !== pendingEffect,
          )
        })

      return pendingEffect
    })

    const poolCompletionEffect: PendingEffect = {
      name: "parallel-hd-pool-close",
      promise: Promise.resolve(),
    }

    poolCompletionEffect.promise = Promise.allSettled(
      taskEffects.map((effect) => effect.promise),
    )
      .then(() => this.workerPool?.close())
      .finally(() => {
        this.workerPool = null
        this.pendingEffects = this.pendingEffects.filter(
          (effect) => effect !== poolCompletionEffect,
        )
      })

    this.pendingEffects = [...taskEffects, poolCompletionEffect]
  }

  private syncFallbackFromSolver() {
    if (!this.fallbackSolver) {
      return
    }

    this.routes = this.fallbackSolver.routes
    this.nodeSolveMetadataById = new Map(
      Array.from(this.fallbackSolver.nodeSolveMetadataById.entries()).map(
        ([capacityMeshNodeId, metadata]) => [
          capacityMeshNodeId,
          {
            ...metadata,
            supervisorType: metadata.solverType,
          },
        ],
      ),
    )
    this.stats = this.fallbackSolver.stats
    this.error = this.fallbackSolver.error
    this.solved = this.fallbackSolver.solved
    this.failed = this.fallbackSolver.failed
    this.progress = this.fallbackSolver.progress
    this.activeSubSolver = this.fallbackSolver.activeSubSolver
  }

  private createNodeMarkerLabel(
    capacityMeshNodeId: CapacityMeshNodeId,
    metadata: NodeSolveMetadata,
  ): string {
    const connectionNames = Array.from(
      new Set(metadata.node.portPoints.map((p) => p.connectionName)),
    )

    return [
      "hd_node_marker",
      `node: ${capacityMeshNodeId}`,
      `status: ${metadata.status}`,
      `solver: ${metadata.solverType}`,
      `supervisor: ${metadata.supervisorType}`,
      `iterations: ${metadata.iterations}`,
      `routes: ${metadata.routeCount}`,
      `nodePf: ${metadata.nodePf ?? "n/a"}`,
      `portPoints: ${metadata.node.portPoints.length}`,
      `connections: ${connectionNames.join(", ")}`,
      ...(metadata.error ? [`error: ${metadata.error}`] : []),
    ].join("\n")
  }

  private getVisibleRoutes() {
    if (this.solved) {
      return this.routes
    }

    const visibleRoutes: HighDensityIntraNodeRoute[] = []
    for (let i = this.unsolvedNodePortPoints.length - 1; i >= 0; i--) {
      visibleRoutes.push(...(this.solvedRoutesByNodeIndex.get(i) ?? []))
    }
    return visibleRoutes
  }

  override _step() {
    if (this.fallbackSolver) {
      this.fallbackSolver.step()
      this.syncFallbackFromSolver()
      return
    }

    if (!this.launchedWorkerPool) {
      this.launchedWorkerPool = true
      this.launchWorkerPool()
      return
    }

    if (this.pendingEffects.length > 0) {
      return
    }

    if (this.failedNodeResults.length > 0) {
      const firstFailure = this.failedNodeResults[0]
      this.failed = true
      this.error = `Failed to solve ${this.failedNodeResults.length} nodes. First failure: ${firstFailure?.node.capacityMeshNodeId} (${firstFailure?.error})`
      return
    }

    this.routes = []
    for (let i = this.unsolvedNodePortPoints.length - 1; i >= 0; i--) {
      this.routes.push(...(this.solvedRoutesByNodeIndex.get(i) ?? []))
    }
    this.solved = true
  }

  override visualize(): GraphicsObject {
    if (this.fallbackSolver) {
      return this.fallbackSolver.visualize()
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    for (const route of this.getVisibleRoutes()) {
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

      for (const segment of mergedSegments) {
        graphics.lines!.push({
          points: segment.points,
          label: segment.connectionName,
          strokeColor:
            segment.z === 0
              ? segment.color
              : safeTransparentize(segment.color, 0.5),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? [0.1, 0.3] : undefined,
        })
      }

      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          layer: "z0,1",
          radius: route.viaDiameter / 2,
          fill: this.colorMap[route.connectionName],
          label: `${route.connectionName} via`,
        })
      }
    }

    if (!this.solved && !this.failed) {
      return graphics
    }

    for (const [capacityMeshNodeId, metadata] of this.nodeSolveMetadataById) {
      const left = metadata.node.center.x - metadata.node.width / 2
      const right = metadata.node.center.x + metadata.node.width / 2
      const top = metadata.node.center.y - metadata.node.height / 2
      const bottom = metadata.node.center.y + metadata.node.height / 2
      const label = this.createNodeMarkerLabel(capacityMeshNodeId, metadata)
      const markerColor = metadata.status === "solved" ? "blue" : "red"

      graphics.lines!.push(
        {
          points: [
            { x: left, y: top },
            { x: right, y: top },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: metadata.status === "solved" ? 0.03 : 0.08,
          label,
        },
        {
          points: [
            { x: right, y: top },
            { x: right, y: bottom },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: metadata.status === "solved" ? 0.03 : 0.08,
          label,
        },
        {
          points: [
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: metadata.status === "solved" ? 0.03 : 0.08,
          label,
        },
        {
          points: [
            { x: left, y: bottom },
            { x: left, y: top },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: metadata.status === "solved" ? 0.03 : 0.08,
          label,
        },
      )

      if (metadata.status === "solved") {
        graphics.points!.push({
          x: metadata.node.center.x,
          y: metadata.node.center.y,
          color: markerColor,
          layer: "hd_node_markers",
          label,
        })
      }
    }

    return graphics
  }
}
