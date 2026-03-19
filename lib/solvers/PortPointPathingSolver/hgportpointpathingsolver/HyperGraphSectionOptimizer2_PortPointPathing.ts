import {
  convertConnectionsToSerializedConnections,
  convertHyperGraphToSerializedHyperGraph,
  createBlankHyperGraph,
  extractSectionOfHyperGraph,
  markDeadEndPorts,
  reattachSectionToGraph,
  type Connection,
  type CreateSectionSolverInput,
  type HyperGraph,
  type HyperGraphSectionOptimizer2Input,
  type Region,
  type RegionPort,
  type SerializedConnection,
  type SerializedHyperGraph,
  type SerializedSolvedRoute,
  type SolvedRoute,
} from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { computeCostPerRegion } from "./computeCost"
import { HgPortPointPathingSolver } from "./HgPortPointPathingSolverClass"
import type {
  CandidateHg,
  ConnectionHg,
  HgPortPointPathingSolverParams,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
  SolvedRoutesHg,
} from "./types"

const HYPERGRAPH_SECTION_OPTIMIZER_2_CONFIG_KEY =
  "__hyperGraphSectionOptimizer2Config"

type PortPointPathingSectionOptimizer2Config = Pick<
  HgPortPointPathingSolverParams,
  "colorMap" | "effort" | "flags" | "layerCount" | "weights"
>

type SerializedHyperGraphWithHyperGraphConfig = SerializedHyperGraph & {
  [HYPERGRAPH_SECTION_OPTIMIZER_2_CONFIG_KEY]?: PortPointPathingSectionOptimizer2Config
}

export type HyperGraphSectionOptimizer2_PortPointPathingInput =
  HyperGraphSectionOptimizer2Input & PortPointPathingSectionOptimizer2Config

type NormalizedHyperGraphSectionOptimizer2Input = {
  inputGraph: SerializedHyperGraphWithHyperGraphConfig
  inputConnections: SerializedConnection[]
  inputSolvedRoutes: SerializedSolvedRoute[]
  sectionExpansionHops: number
  maxTargetRegionAttempts: number
  maxSectionAttempts: number
  minCentralRegionCost: number
  effort: number
}

type SectionSolveAttempt = {
  targetRegionId: string
  sectionRegionIds: Set<string>
  fullGraphSnapshot: SerializedHyperGraph
  blankSectionProblem: SerializedHyperGraph
  currentSectionCost: number
}

type PendingAttemptSetup = {
  targetRegionId: string
}

type PendingMergedAttempt = {
  mergedGraph: SerializedHyperGraph
  mergedSolver?: HgPortPointPathingSolver
}

type AttemptLifecyclePhase =
  | "idle"
  | "preparingAttempt"
  | "startingSectionSolver"
  | "solvingSection"
  | "mergingSolvedSection"
  | "deserializingMergedGraph"
  | "evaluatingMergedGraph"

export type SectionSolveEvent = {
  attemptNumber: number
  targetRegionId: string
  sectionRegionCount: number
  previousSectionCost: number
  nextSectionCost?: number
  accepted: boolean
  failed: boolean
}

type HyperGraphSectionOptimizer2ConstructorParams = {
  inputGraph: SerializedHyperGraph
  inputConnections: SerializedConnection[]
  inputSolvedRoutes: SerializedSolvedRoute[]
  sectionExpansionHops: number
  maxTargetRegionAttempts: number
  maxSectionAttempts: number
  minCentralRegionCost: number
  effort: number
} & PortPointPathingSectionOptimizer2Config

type HyperGraphSectionOptimizerStats = {
  successfulOptimizations: number
  failedOptimizations: number
  nodesExamined: number
  sectionAttempts: number
  sectionScores: Record<string, number>
  initialBoardScore: number
  currentBoardScore: number
  errors: number
  lastSectionScore?: number
  lastBoardScore?: number
}

const MAX_REGION_PF = 0.99999
const DEFAULT_SECTION_SOLVER_MAX_ITERATIONS = 100_000
const LIFECYCLE_STEPS_PER_SECTION_ATTEMPT = 6

export class HyperGraphSectionOptimizer2_PortPointPathing extends BaseSolver {
  readonly config: NormalizedHyperGraphSectionOptimizer2Input
  rootSolver: HgPortPointPathingSolver
  graph: HyperGraphHg
  connections: ConnectionHg[]
  solvedRoutes: SolvedRoutesHg[]
  activeAttempt: SectionSolveAttempt | null = null
  targetRegionAttemptCounts = new Map<string, number>()
  attemptedSectionCount = 0
  activeSubSolver: HgPortPointPathingSolver | null = null
  sectionSolveEvents: SectionSolveEvent[] = []
  private lifecyclePhase: AttemptLifecyclePhase = "idle"
  private pendingAttemptSetup: PendingAttemptSetup | null = null
  private pendingMergedAttempt: PendingMergedAttempt | null = null
  private portPointPathingConfig: PortPointPathingSectionOptimizer2Config

  constructor(input: HyperGraphSectionOptimizer2_PortPointPathingInput) {
    super()

    this.portPointPathingConfig = getPortPointPathingConfigFromInput(input)
    this.config = normalizeInput({
      ...input,
      inputGraph: {
        ...input.inputGraph,
        [HYPERGRAPH_SECTION_OPTIMIZER_2_CONFIG_KEY]:
          this.portPointPathingConfig,
      } as SerializedHyperGraphWithHyperGraphConfig,
    })

    this.rootSolver = this.createHyperGraphSolver({
      inputGraph: this.config.inputGraph,
      inputConnections: this.config.inputConnections,
      inputSolvedRoutes: this.config.inputSolvedRoutes,
    })
    this.graph = this.rootSolver.graph as HyperGraphHg
    this.connections = this.rootSolver.connections as ConnectionHg[]
    this.solvedRoutes = this.rootSolver.solvedRoutes as SolvedRoutesHg[]
    this.stats = createInitialStats(this.computeBoardScoreForGraph(this.graph))
    this.MAX_ITERATIONS = getMaxIterationsForSectionOptimizer({
      effort: this.config.effort,
      maxSectionAttempts: this.config.maxSectionAttempts,
      maxIterationsPerPath:
        this.portPointPathingConfig.weights.MAX_ITERATIONS_PER_PATH,
    })
  }

  override getSolverName(): string {
    return "HyperGraphSectionOptimizer2_PortPointPathing"
  }

  override getConstructorParams(): HyperGraphSectionOptimizer2ConstructorParams {
    return {
      ...this.portPointPathingConfig,
      inputGraph: convertHyperGraphToSerializedHyperGraph(this.graph),
      inputConnections: convertConnectionsToSerializedConnections(
        this.connections,
      ),
      inputSolvedRoutes: convertSolvedRoutesToSerializedSolvedRoutes(
        this.solvedRoutes,
      ),
      sectionExpansionHops: this.config.sectionExpansionHops,
      maxTargetRegionAttempts: this.config.maxTargetRegionAttempts,
      maxSectionAttempts: this.config.maxSectionAttempts,
      minCentralRegionCost: this.config.minCentralRegionCost,
      effort: this.config.effort,
    }
  }

  getOutput(): SolvedRoutesHg[] {
    return this.solvedRoutes
  }

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    return {
      title: "HyperGraphSectionOptimizer2_PortPointPathing",
      points: [],
      lines: [],
      rects: [],
      circles: [],
      texts: [],
      polygons: [],
      arrows: [],
    }
  }

  protected createHyperGraphSolver(
    input: CreateSectionSolverInput,
  ): HgPortPointPathingSolver {
    const portPointPathingConfig =
      this.portPointPathingConfig ??
      getPortPointPathingConfigFromInputGraph(
        input.inputGraph as SerializedHyperGraphWithHyperGraphConfig,
      )

    const graph = convertSerializedHyperGraphToHyperGraph(
      input.inputGraph,
    ) as HyperGraphHg
    const connections = convertSerializedConnectionsToConnections(
      input.inputConnections,
      graph,
    ) as ConnectionHg[]
    const inputSolvedRoutes = convertSerializedSolvedRoutesToSolvedRoutes(
      input.inputSolvedRoutes,
      graph,
    ) as SolvedRoutesHg[]

    return new HgPortPointPathingSolver({
      graph,
      connections,
      inputSolvedRoutes,
      colorMap: portPointPathingConfig.colorMap,
      effort: portPointPathingConfig.effort,
      flags: portPointPathingConfig.flags,
      layerCount: portPointPathingConfig.layerCount,
      weights: portPointPathingConfig.weights,
    })
  }

  getCostOfCentralRegion(region: Region): number {
    const attempts = this.targetRegionAttemptCounts.get(region.regionId) ?? 0
    return computeCostPerRegion(region) + attempts * 10_000
  }

  private computeSectionCostForGraph(
    graph: HyperGraph,
    sectionRegionIds: Set<string>,
  ): number {
    let totalCost = 0
    for (const region of graph.regions) {
      if (!sectionRegionIds.has(region.regionId)) continue
      totalCost += computeCostPerRegion(region)
    }

    return totalCost
  }

  private computeBoardScoreForGraph(graph: HyperGraph): number {
    return this.computeScoreForGraph(graph)
  }

  private computeScoreForGraph(
    graph: HyperGraph,
    sectionRegionIds?: Set<string>,
  ): number {
    let totalScore = 0
    for (const region of graph.regions) {
      if (sectionRegionIds && !sectionRegionIds.has(region.regionId)) continue
      if (!doesRegionContributeToScore(region)) continue
      totalScore += Math.log(
        1 - Math.min(computeCostPerRegion(region), MAX_REGION_PF),
      )
    }
    return totalScore
  }

  private getStats(): HyperGraphSectionOptimizerStats {
    return this.stats as HyperGraphSectionOptimizerStats
  }

  override _step() {
    switch (this.lifecyclePhase) {
      case "idle":
        this.queueNextSectionAttempt()
        return
      case "preparingAttempt":
        this.prepareQueuedAttempt()
        return
      case "startingSectionSolver":
        this.startPreparedSectionSolver()
        return
      case "solvingSection":
        this.stepActiveSectionSolver()
        return
      case "mergingSolvedSection":
        this.mergeSolvedSection()
        return
      case "deserializingMergedGraph":
        this.deserializeMergedGraph()
        return
      case "evaluatingMergedGraph":
        this.evaluateMergedGraph()
        return
    }
  }

  private queueNextSectionAttempt() {
    if (this.attemptedSectionCount >= this.config.maxSectionAttempts) {
      this.solved = true
      return
    }

    const targetRegion = this.selectTargetRegion()
    if (!targetRegion) {
      this.solved = true
      return
    }

    this.attemptedSectionCount += 1
    const stats = this.getStats()
    stats.sectionAttempts = this.attemptedSectionCount
    stats.nodesExamined += 1

    this.pendingAttemptSetup = {
      targetRegionId: targetRegion.regionId,
    }
    this.lifecyclePhase = "preparingAttempt"
  }

  private prepareQueuedAttempt() {
    const targetRegion = this.getTargetRegionForPendingAttempt()
    if (!targetRegion) {
      this.clearPendingAttemptSetup()
      this.lifecyclePhase = "idle"
      return
    }

    const nextAttempt = this.createSectionSolveAttempt(targetRegion)
    if (!nextAttempt) {
      const stats = this.getStats()
      stats.failedOptimizations += 1
      this.bumpTargetRegionAttemptCount(targetRegion.regionId)
      this.clearPendingAttemptSetup()
      this.lifecyclePhase = "idle"
      return
    }

    this.activeAttempt = nextAttempt
    this.clearPendingAttemptSetup()
    this.lifecyclePhase = "startingSectionSolver"
  }

  private startPreparedSectionSolver() {
    if (!this.activeAttempt) {
      this.clearActiveAttempt()
      return
    }

    this.activeSubSolver = this.createHyperGraphSolver({
      inputGraph: this.activeAttempt.blankSectionProblem,
      inputConnections:
        this.activeAttempt.blankSectionProblem.connections ?? [],
      inputSolvedRoutes: [],
    })
    this.lifecyclePhase = "solvingSection"
  }

  private stepActiveSectionSolver() {
    if (!this.activeSubSolver) {
      this.clearActiveAttempt()
      return
    }

    this.activeSubSolver.step()

    if (!this.activeAttempt) return

    if (this.activeSubSolver.failed) {
      const stats = this.getStats()
      if (this.activeSubSolver.error) {
        stats.errors += 1
      }
      stats.failedOptimizations += 1
      this.sectionSolveEvents.push({
        attemptNumber: this.attemptedSectionCount,
        targetRegionId: this.activeAttempt.targetRegionId,
        sectionRegionCount: this.activeAttempt.sectionRegionIds.size,
        previousSectionCost: this.activeAttempt.currentSectionCost,
        accepted: false,
        failed: true,
      })
      this.rejectActiveAttempt()
      return
    }

    if (!this.activeSubSolver.solved) return

    this.lifecyclePhase = "mergingSolvedSection"
  }

  private mergeSolvedSection() {
    if (!this.activeAttempt || !this.activeSubSolver?.solved) {
      this.clearActiveAttempt()
      return
    }

    const solvedBlankSection: SerializedHyperGraph = {
      ...this.activeAttempt.blankSectionProblem,
      solvedRoutes: convertSolvedRoutesToSerializedSolvedRoutes(
        this.activeSubSolver.solvedRoutes,
      ),
    }
    this.pendingMergedAttempt = {
      mergedGraph: reattachSectionToGraph({
        fullGraph: this.activeAttempt.fullGraphSnapshot,
        solvedSectionGraph: solvedBlankSection,
      }),
    }
    this.activeSubSolver = null
    this.lifecyclePhase = "deserializingMergedGraph"
  }

  private deserializeMergedGraph() {
    if (!this.pendingMergedAttempt) {
      this.clearActiveAttempt()
      return
    }

    this.pendingMergedAttempt.mergedSolver = this.createHyperGraphSolver({
      inputGraph: this.pendingMergedAttempt.mergedGraph,
      inputConnections: this.pendingMergedAttempt.mergedGraph.connections ?? [],
      inputSolvedRoutes:
        this.pendingMergedAttempt.mergedGraph.solvedRoutes ?? [],
    })
    this.lifecyclePhase = "evaluatingMergedGraph"
  }

  private evaluateMergedGraph() {
    if (!this.activeAttempt || !this.pendingMergedAttempt?.mergedSolver) {
      this.clearActiveAttempt()
      return
    }

    const mergedSolver = this.pendingMergedAttempt.mergedSolver
    const mergedSectionCost = this.computeSectionCostForGraph(
      mergedSolver.graph,
      this.activeAttempt.sectionRegionIds,
    )
    const stats = this.getStats()
    const previousBoardScore = stats.currentBoardScore
    const nextBoardScore = this.computeBoardScoreForGraph(mergedSolver.graph)
    stats.lastSectionScore = this.computeScoreForGraph(
      mergedSolver.graph,
      this.activeAttempt.sectionRegionIds,
    )
    stats.lastBoardScore = previousBoardScore

    if (
      mergedSectionCost < this.activeAttempt.currentSectionCost &&
      nextBoardScore > previousBoardScore
    ) {
      const attemptKey = `attempt${this.attemptedSectionCount}`
      stats.sectionScores[attemptKey] = nextBoardScore
      stats.successfulOptimizations += 1
      stats.currentBoardScore = nextBoardScore
      this.sectionSolveEvents.push({
        attemptNumber: this.attemptedSectionCount,
        targetRegionId: this.activeAttempt.targetRegionId,
        sectionRegionCount: this.activeAttempt.sectionRegionIds.size,
        previousSectionCost: this.activeAttempt.currentSectionCost,
        nextSectionCost: mergedSectionCost,
        accepted: true,
        failed: false,
      })
      this.pendingMergedAttempt = null
      this.acceptMergedSolver(mergedSolver)
      return
    }

    stats.failedOptimizations += 1
    this.sectionSolveEvents.push({
      attemptNumber: this.attemptedSectionCount,
      targetRegionId: this.activeAttempt.targetRegionId,
      sectionRegionCount: this.activeAttempt.sectionRegionIds.size,
      previousSectionCost: this.activeAttempt.currentSectionCost,
      nextSectionCost: mergedSectionCost,
      accepted: false,
      failed: false,
    })
    this.pendingMergedAttempt = null
    this.rejectActiveAttempt()
  }

  private selectTargetRegion(): RegionHg | null {
    let bestRegion: RegionHg | null = null
    let bestCost = Number.POSITIVE_INFINITY

    for (const region of this.graph.regions) {
      if ((region.assignments?.length ?? 0) === 0) continue
      if (
        (this.targetRegionAttemptCounts.get(region.regionId) ?? 0) >=
        this.config.maxTargetRegionAttempts
      ) {
        continue
      }

      const cost = this.getCostOfCentralRegion(region)
      if (cost <= this.config.minCentralRegionCost) continue
      if (cost >= bestCost) continue
      bestCost = cost
      bestRegion = region
    }

    return bestRegion
  }

  private createSectionSolveAttempt(
    targetRegion: RegionHg,
  ): SectionSolveAttempt | null {
    const fullGraphSnapshot = this.serializeSolvedGraph()
    const extractedSection = extractSectionOfHyperGraph({
      graph: fullGraphSnapshot,
      centralRegionId: targetRegion.regionId,
      expansionHopsFromCentralRegion: this.config.sectionExpansionHops,
    })
    const sectionWithDeadEndMarks =
      this.markSectionDeadEndsForBlanking(extractedSection)

    if ((sectionWithDeadEndMarks.connections?.length ?? 0) === 0) {
      return null
    }

    const sectionRegionIds = this.getSectionRegionIds(extractedSection)
    return {
      targetRegionId: targetRegion.regionId,
      sectionRegionIds,
      fullGraphSnapshot,
      blankSectionProblem: createBlankHyperGraph(sectionWithDeadEndMarks),
      currentSectionCost: this.computeSectionCostForGraph(
        this.graph,
        sectionRegionIds,
      ),
    }
  }

  private markSectionDeadEndsForBlanking(
    extractedSection: SerializedHyperGraph,
  ): SerializedHyperGraph {
    const mutableSectionGraph =
      convertSerializedHyperGraphToHyperGraph(extractedSection)
    const retainedPortIds = new Set(
      (extractedSection.solvedRoutes ?? []).flatMap((solvedRoute) =>
        solvedRoute.path.map((candidate) => candidate.portId),
      ),
    )

    markDeadEndPorts(mutableSectionGraph, retainedPortIds)

    return {
      ...convertHyperGraphToSerializedHyperGraph(mutableSectionGraph),
      connections: extractedSection.connections
        ? structuredClone(extractedSection.connections)
        : undefined,
      solvedRoutes: extractedSection.solvedRoutes
        ? structuredClone(extractedSection.solvedRoutes)
        : undefined,
      _sectionCentralRegionId: extractedSection._sectionCentralRegionId,
      _sectionRouteBindings: extractedSection._sectionRouteBindings
        ? structuredClone(extractedSection._sectionRouteBindings)
        : undefined,
    }
  }

  private acceptMergedSolver(mergedSolver: HgPortPointPathingSolver) {
    this.rootSolver = mergedSolver
    this.solvedRoutes = mergedSolver.solvedRoutes as SolvedRoutesHg[]
    this.graph = mergedSolver.graph as HyperGraphHg
    this.connections = mergedSolver.connections as ConnectionHg[]

    for (const regionId of this.activeAttempt?.sectionRegionIds ?? []) {
      this.targetRegionAttemptCounts.set(regionId, 0)
    }

    this.clearActiveAttempt()
  }

  private rejectActiveAttempt() {
    if (this.activeSubSolver?.failed) {
      this.failedSubSolvers ??= []
      this.failedSubSolvers.push(this.activeSubSolver as any)
    }

    if (this.activeAttempt) {
      this.bumpTargetRegionAttemptCount(this.activeAttempt.targetRegionId)
    }

    this.clearActiveAttempt()
  }

  private clearActiveAttempt() {
    this.activeSubSolver = null
    this.activeAttempt = null
    this.pendingAttemptSetup = null
    this.pendingMergedAttempt = null
    this.lifecyclePhase = "idle"
  }

  private bumpTargetRegionAttemptCount(regionId: string) {
    this.targetRegionAttemptCounts.set(
      regionId,
      (this.targetRegionAttemptCounts.get(regionId) ?? 0) + 1,
    )
  }

  private serializeSolvedGraph(): SerializedHyperGraph {
    return {
      ...convertHyperGraphToSerializedHyperGraph(this.graph),
      connections: convertConnectionsToSerializedConnections(this.connections),
      solvedRoutes: convertSolvedRoutesToSerializedSolvedRoutes(
        this.solvedRoutes,
      ),
    }
  }

  private getSectionRegionIds(sectionGraph: SerializedHyperGraph): Set<string> {
    const fullRegionIds = new Set(
      this.graph.regions.map((region) => region.regionId),
    )
    return new Set(
      sectionGraph.regions
        .map((region) => region.regionId)
        .filter((regionId) => fullRegionIds.has(regionId)),
    )
  }

  private getTargetRegionForPendingAttempt(): RegionHg | null {
    const targetRegionId = this.pendingAttemptSetup?.targetRegionId
    if (!targetRegionId) return null
    return (
      (this.graph.regions.find(
        (region) => region.regionId === targetRegionId,
      ) as RegionHg | undefined) ?? null
    )
  }

  private clearPendingAttemptSetup() {
    this.pendingAttemptSetup = null
  }
}

export const convertSolvedRoutesToSerializedSolvedRoutes = (
  solvedRoutes: SolvedRoute[],
): SerializedSolvedRoute[] => {
  return solvedRoutes.map((solvedRoute) => ({
    path: solvedRoute.path.map((candidate) => ({
      portId: candidate.port.portId,
      g: candidate.g,
      h: candidate.h,
      f: candidate.f,
      hops: candidate.hops,
      ripRequired: candidate.ripRequired,
      lastPortId: candidate.lastPort?.portId,
      lastRegionId: candidate.lastRegion?.regionId,
      nextRegionId: candidate.nextRegion?.regionId,
    })),
    connection: convertConnectionsToSerializedConnections([
      solvedRoute.connection,
    ])[0]!,
    requiredRip: solvedRoute.requiredRip,
  }))
}

const getPortPointPathingConfigFromInput = (
  input: HyperGraphSectionOptimizer2_PortPointPathingInput,
): PortPointPathingSectionOptimizer2Config => {
  return {
    colorMap: input.colorMap,
    effort: input.effort ?? 1,
    flags: structuredClone(input.flags),
    layerCount: input.layerCount,
    weights: structuredClone(input.weights),
  }
}

const getPortPointPathingConfigFromInputGraph = (
  inputGraph: SerializedHyperGraphWithHyperGraphConfig,
): PortPointPathingSectionOptimizer2Config => {
  const portPointPathingConfig =
    inputGraph[HYPERGRAPH_SECTION_OPTIMIZER_2_CONFIG_KEY]
  if (!portPointPathingConfig) {
    throw new Error(
      "HyperGraphSectionOptimizer2_PortPointPathing config missing from graph",
    )
  }
  return portPointPathingConfig
}

const normalizeInput = (
  input: HyperGraphSectionOptimizer2_PortPointPathingInput,
): NormalizedHyperGraphSectionOptimizer2Input => {
  const inputConnections =
    input.inputConnections ?? input.inputGraph.connections
  const inputSolvedRoutes =
    input.inputSolvedRoutes ?? input.inputGraph.solvedRoutes
  const sectionExpansionHops =
    input.sectionExpansionHops ?? input.expansionHopsFromCentralRegion
  const maxTargetRegionAttempts =
    input.maxTargetRegionAttempts ?? input.MAX_ATTEMPTS_PER_REGION

  if (!inputConnections) {
    throw new Error(
      "HyperGraphSectionOptimizer2_PortPointPathing requires inputConnections",
    )
  }
  if (!inputSolvedRoutes) {
    throw new Error(
      "HyperGraphSectionOptimizer2_PortPointPathing requires inputSolvedRoutes",
    )
  }
  if (sectionExpansionHops === undefined) {
    throw new Error(
      "HyperGraphSectionOptimizer2_PortPointPathing requires sectionExpansionHops",
    )
  }
  if (maxTargetRegionAttempts === undefined) {
    throw new Error(
      "HyperGraphSectionOptimizer2_PortPointPathing requires maxTargetRegionAttempts",
    )
  }

  return {
    inputGraph: {
      ...input.inputGraph,
      connections: undefined,
      solvedRoutes: undefined,
    },
    inputConnections: structuredClone(inputConnections),
    inputSolvedRoutes: structuredClone(inputSolvedRoutes),
    sectionExpansionHops,
    maxTargetRegionAttempts,
    maxSectionAttempts:
      input.maxSectionAttempts ?? input.MAX_ATTEMPTS_PER_SECTION ?? 500,
    minCentralRegionCost:
      input.minCentralRegionCost ?? input.ACCEPTABLE_CENTRAL_REGION_COST ?? 0,
    effort: input.effort ?? 1,
  }
}

const createInitialStats = (
  initialBoardScore: number,
): HyperGraphSectionOptimizerStats => ({
  successfulOptimizations: 0,
  failedOptimizations: 0,
  nodesExamined: 0,
  sectionAttempts: 0,
  sectionScores: {},
  initialBoardScore,
  currentBoardScore: initialBoardScore,
  errors: 0,
})

const getMaxIterationsForSectionOptimizer = (input: {
  effort: number
  maxSectionAttempts: number
  maxIterationsPerPath: number
}): number => {
  const sectionSolverMaxIterations =
    input.maxIterationsPerPath > 0
      ? Math.ceil(input.maxIterationsPerPath * input.effort)
      : DEFAULT_SECTION_SOLVER_MAX_ITERATIONS

  return Math.max(
    DEFAULT_SECTION_SOLVER_MAX_ITERATIONS,
    input.maxSectionAttempts *
      (sectionSolverMaxIterations + LIFECYCLE_STEPS_PER_SECTION_ATTEMPT),
  )
}

const doesRegionContributeToScore = (region: Region): boolean => {
  if ((region.assignments?.length ?? 0) === 0) return false
  return !region.d?._containsTarget
}

const convertSerializedHyperGraphToHyperGraph = (
  inputGraph: SerializedHyperGraph,
): HyperGraph => {
  if (
    inputGraph.ports.length > 0 &&
    "region1" in inputGraph.ports[0]! &&
    typeof inputGraph.ports[0]!.region1 === "object"
  ) {
    return inputGraph as unknown as HyperGraph
  }

  const portMap = new Map<string, RegionPort>()
  const regionMap = new Map<string, Region>()

  for (const region of inputGraph.regions) {
    const { assignments: _assignments, ...regionWithoutAssignments } =
      region as unknown as Region & { assignments?: unknown }
    regionMap.set(region.regionId, {
      ...regionWithoutAssignments,
      d: regionWithoutAssignments.d
        ? structuredClone(regionWithoutAssignments.d)
        : regionWithoutAssignments.d,
      ports: [],
      assignments: undefined,
    })
  }

  for (const port of inputGraph.ports) {
    const region1 = regionMap.get(port.region1Id)
    const region2 = regionMap.get(port.region2Id)

    if (!region1 || !region2) {
      throw new Error(`Failed to deserialize port ${port.portId}`)
    }

    const deserializedPort: RegionPort = {
      portId: port.portId,
      region1,
      region2,
      d: port.d,
    }

    portMap.set(port.portId, deserializedPort)
    region1.ports.push(deserializedPort)
    region2.ports.push(deserializedPort)
  }

  return {
    ports: Array.from(portMap.values()),
    regions: Array.from(regionMap.values()),
  }
}

const convertSerializedConnectionsToConnections = (
  inputConnections: SerializedConnection[],
  graph: HyperGraph,
): Connection[] => {
  return inputConnections.map((inputConnection) => {
    const startRegion = graph.regions.find(
      (region) => region.regionId === inputConnection.startRegionId,
    )
    const endRegion = graph.regions.find(
      (region) => region.regionId === inputConnection.endRegionId,
    )

    if (!startRegion || !endRegion) {
      throw new Error(
        `Failed to deserialize connection ${inputConnection.connectionId}`,
      )
    }

    return {
      connectionId: inputConnection.connectionId,
      mutuallyConnectedNetworkId:
        inputConnection.mutuallyConnectedNetworkId ??
        inputConnection.connectionId,
      startRegion,
      endRegion,
    }
  })
}

const convertSerializedSolvedRoutesToSolvedRoutes = (
  inputSolvedRoutes: SerializedSolvedRoute[],
  graph: HyperGraph,
): SolvedRoute[] => {
  const portMap = new Map(graph.ports.map((port) => [port.portId, port]))
  const regionMap = new Map(
    graph.regions.map((region) => [region.regionId, region]),
  )
  const connectionMap = new Map(
    convertSerializedConnectionsToConnections(
      inputSolvedRoutes.map((route) => route.connection),
      graph,
    ).map((connection) => [connection.connectionId, connection]),
  )

  return inputSolvedRoutes.map((inputSolvedRoute) => {
    const path: CandidateHg[] = []

    for (const originalCandidate of inputSolvedRoute.path) {
      const port = getRequiredPort(
        portMap,
        originalCandidate.portId,
        inputSolvedRoute.connection.connectionId,
      )

      const candidate: CandidateHg = {
        port: port as RegionPortHg,
        g: originalCandidate.g,
        h: originalCandidate.h,
        f: originalCandidate.f,
        hops: originalCandidate.hops,
        ripRequired: originalCandidate.ripRequired,
      }

      if (originalCandidate.lastPortId) {
        candidate.lastPort = getRequiredPort(
          portMap,
          originalCandidate.lastPortId,
          inputSolvedRoute.connection.connectionId,
        ) as RegionPortHg
      }

      if (originalCandidate.lastRegionId) {
        candidate.lastRegion = getRequiredRegion(
          regionMap,
          originalCandidate.lastRegionId,
          inputSolvedRoute.connection.connectionId,
        ) as RegionHg
      }

      if (originalCandidate.nextRegionId) {
        candidate.nextRegion = getRequiredRegion(
          regionMap,
          originalCandidate.nextRegionId,
          inputSolvedRoute.connection.connectionId,
        ) as RegionHg
      }

      const parent = path[path.length - 1]
      if (parent) candidate.parent = parent
      path.push(candidate)
    }

    return {
      path,
      connection: getRequiredConnection(
        connectionMap,
        inputSolvedRoute.connection.connectionId,
      ) as ConnectionHg,
      requiredRip: inputSolvedRoute.requiredRip,
    }
  })
}

const getRequiredPort = (
  portMap: Map<string, RegionPort>,
  portId: string,
  connectionId: string,
): RegionPort => {
  const port = portMap.get(portId)
  if (!port) {
    throw new Error(
      `Port ${portId} not found while deserializing solved route ${connectionId}`,
    )
  }
  return port
}

const getRequiredRegion = (
  regionMap: Map<string, Region>,
  regionId: string,
  connectionId: string,
): Region => {
  const region = regionMap.get(regionId)
  if (!region) {
    throw new Error(
      `Region ${regionId} not found while deserializing solved route ${connectionId}`,
    )
  }
  return region
}

const getRequiredConnection = (
  connectionMap: Map<string, Connection>,
  connectionId: string,
): Connection => {
  const connection = connectionMap.get(connectionId)
  if (!connection) {
    throw new Error(
      `Connection ${connectionId} not found while deserializing solved route`,
    )
  }
  return connection
}

export const serializeHyperGraph = (
  graph: HyperGraphHg,
): SerializedHyperGraph => {
  return convertHyperGraphToSerializedHyperGraph(graph)
}
