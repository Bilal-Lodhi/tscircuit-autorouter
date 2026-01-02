import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type {
  HighDensityIntraNodeRoute,
  HighDensityIntraNodeRouteWithJumpers,
  Jumper,
  NodeWithPortPoints,
  PortPoint,
} from "../../types/high-density-types"
import { SimpleHighDensitySolver } from "../../autorouter-pipelines/AssignableAutoroutingPipeline2/SimpleHighDensitySolver"
import { MultipleHighDensityRouteStitchSolver } from "../RouteStitchingSolver/MultipleHighDensityRouteStitchSolver"
import {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "../PortPointPathingSolver/PortPointPathingSolver"
import {
  HyperPortPointPathingSolver,
  HyperPortPointPathingSolverParams,
} from "../PortPointPathingSolver/HyperPortPointPathingSolver"
import { MultiSectionPortPointOptimizer } from "../MultiSectionPortPointOptimizer"
import { safeTransparentize } from "../colors"
import { distance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimpleRouteConnection } from "../../types"
import { AvailableSegmentPointSolver } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, CapacityMeshEdge } from "../../types"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { getConnectivityMapFromSimpleRouteJson } from "../../utils/getConnectivityMapFromSimpleRouteJson"
import { getColorMap } from "../colors"
import { RelateNodesToOffBoardConnectionsSolver } from "../../autorouter-pipelines/AssignableAutoroutingPipeline2/RelateNodesToOffBoardConnectionsSolver"
import { updateConnMapWithOffboardObstacleConnections } from "../../autorouter-pipelines/AssignableAutoroutingPipeline2/updateConnMapWithOffboardObstacleConnections"

/**
 * 0805 footprint dimensions in mm
 * Actual 0805: 2.0mm x 1.25mm
 */
const JUMPER_0805 = {
  length: 2.0,
  width: 1.25,
  padLength: 0.5,
  padWidth: 1.25,
}

/**
 * 0603 footprint dimensions in mm
 * Actual 0603: 1.6mm x 0.8mm
 */
const JUMPER_0603 = {
  length: 1.6,
  width: 0.8,
  padLength: 0.4,
  padWidth: 0.8,
}

/**
 * 1206 footprint dimensions in mm
 * Actual 1206: 3.2mm x 1.6mm
 */
const JUMPER_1206 = {
  length: 3.2,
  width: 1.6,
  padLength: 0.6,
  padWidth: 1.6,
}

const JUMPER_DIMENSIONS: Record<JumperFootprint, typeof JUMPER_0805> = {
  "0805": JUMPER_0805,
  "0603": JUMPER_0603,
  "1206": JUMPER_1206,
}

type JumperFootprint = "0805" | "0603" | "1206"

interface PrepatternJumper {
  jumperId: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  footprint: JumperFootprint
  /** Shared offBoardConnectsTo ID for both pads */
  offBoardConnectionId: string
}

export interface JumperPrepatternSolverParams {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  jumperFootprint?: JumperFootprint
  hyperParameters?: Record<string, number>
  connMap?: ConnectivityMap
}

type PipelineStep<T extends new (...args: any[]) => BaseSolver> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    instance: JumperPrepatternSolver,
  ) => ConstructorParameters<T>
  onSolved?: (instance: JumperPrepatternSolver) => void
}

function definePipelineStep<
  T extends new (
    ...args: any[]
  ) => BaseSolver,
  const P extends ConstructorParameters<T>,
>(
  solverName: keyof JumperPrepatternSolver,
  solverClass: T,
  getConstructorParams: (instance: JumperPrepatternSolver) => P,
  opts: {
    onSolved?: (instance: JumperPrepatternSolver) => void
  } = {},
): PipelineStep<T> {
  return {
    solverName,
    solverClass,
    getConstructorParams,
    onSolved: opts.onSolved,
  }
}

export class JumperPrepatternSolver extends BaseSolver {
  // Input parameters
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  jumperFootprint: JumperFootprint
  hyperParameters: Record<string, number>
  connMap: ConnectivityMap

  // Generated data
  prepatternJumpers: PrepatternJumper[] = []
  capacityNodes: CapacityMeshNode[] = []
  capacityEdges: CapacityMeshEdge[] = []
  inputNodes: InputNodeWithPortPoints[] = []
  connections: SimpleRouteConnection[] = []
  srjWithPointPairs: SimpleRouteJson

  // Sub-solvers
  nodeSolver?: RectDiffPipeline
  relateNodesToOffBoardConnections?: RelateNodesToOffBoardConnectionsSolver
  edgeSolver?: CapacityMeshEdgeSolver2_NodeTreeOptimization
  availableSegmentPointSolver?: AvailableSegmentPointSolver
  portPointPathingSolver?: HyperPortPointPathingSolver
  multiSectionPortPointOptimizer?: MultiSectionPortPointOptimizer
  highDensitySolver?: SimpleHighDensitySolver
  highDensityStitchSolver?: MultipleHighDensityRouteStitchSolver

  activeSubSolver?: BaseSolver | null = null
  currentPipelineStepIndex = 0

  startTimeOfPhase: Record<string, number> = {}
  endTimeOfPhase: Record<string, number> = {}
  timeSpentOnPhase: Record<string, number> = {}

  // Output
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []

  pipelineDef = [
    definePipelineStep(
      "nodeSolver",
      RectDiffPipeline,
      (solver) => [{ simpleRouteJson: solver.srjWithPointPairs as any }],
      {
        onSolved: (solver) => {
          solver.capacityNodes = solver.nodeSolver?.getOutput().meshNodes ?? []
        },
      },
    ),
    definePipelineStep(
      "relateNodesToOffBoardConnections",
      RelateNodesToOffBoardConnectionsSolver,
      (solver) => [
        {
          capacityMeshNodes: solver.capacityNodes,
          srj: solver.srjWithPointPairs,
        },
      ],
      {
        onSolved: (solver) => {
          solver.capacityNodes =
            solver.relateNodesToOffBoardConnections?.getOutput().capacityNodes!
        },
      },
    ),
    definePipelineStep(
      "edgeSolver",
      CapacityMeshEdgeSolver2_NodeTreeOptimization,
      (solver) => [solver.capacityNodes],
      {
        onSolved: (solver) => {
          solver.capacityEdges = solver.edgeSolver?.edges ?? []
        },
      },
    ),
    definePipelineStep(
      "availableSegmentPointSolver",
      AvailableSegmentPointSolver,
      (solver) => [
        {
          nodes: solver.capacityNodes,
          edges: solver.capacityEdges,
          traceWidth: solver.traceWidth,
          colorMap: solver.colorMap,
        },
      ],
    ),
    definePipelineStep(
      "portPointPathingSolver",
      HyperPortPointPathingSolver,
      (solver) => {
        // Build input nodes with port points from the segment solver
        const inputNodes: InputNodeWithPortPoints[] = solver.capacityNodes.map(
          (node) => ({
            capacityMeshNodeId: node.capacityMeshNodeId,
            center: node.center,
            width: node.width,
            height: node.height,
            portPoints: [] as InputPortPoint[],
            availableZ: node.availableZ,
            _containsTarget: node._containsTarget,
            _containsObstacle: node._containsObstacle,
            _offBoardConnectionId: node._offBoardConnectionId,
            _offBoardConnectedCapacityMeshNodeIds:
              node._offBoardConnectedCapacityMeshNodeIds,
          }),
        )

        // Build a map for quick lookup
        const nodeMap = new Map(
          inputNodes.map((n) => [n.capacityMeshNodeId, n]),
        )

        // Add port points from the available segment point solver
        const segmentPointSolver = solver.availableSegmentPointSolver!
        for (const segment of segmentPointSolver.sharedEdgeSegments) {
          for (const segmentPortPoint of segment.portPoints) {
            const [nodeId1, nodeId2] = segmentPortPoint.nodeIds
            const inputPortPoint: InputPortPoint = {
              portPointId: segmentPortPoint.segmentPortPointId,
              x: segmentPortPoint.x,
              y: segmentPortPoint.y,
              z: segmentPortPoint.availableZ[0] ?? 0,
              connectionNodeIds: [nodeId1, nodeId2],
              distToCentermostPortOnZ: segmentPortPoint.distToCentermostPortOnZ,
              connectsToOffBoardNode: segment.nodeIds.some(
                (n) => nodeMap.get(n)?._offBoardConnectionId,
              ),
            }

            // Add to first node
            const node1 = nodeMap.get(nodeId1)
            if (node1) {
              node1.portPoints.push(inputPortPoint)
            }
          }
        }

        solver.inputNodes = inputNodes

        return [
          {
            simpleRouteJson: solver.srjWithPointPairs,
            inputNodes,
            capacityMeshNodes: solver.capacityNodes,
            colorMap: solver.colorMap,
            numShuffleSeeds: 100,
            hyperParameters: {
              NODE_PF_FACTOR: 100,
              NODE_PF_MAX_PENALTY: 100,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
              FORCE_CENTER_FIRST: true,
            },
          } as HyperPortPointPathingSolverParams,
        ]
      },
      {
        onSolved: (solver) => {
          const pathingSolver = solver.portPointPathingSolver
          if (!pathingSolver) return
          updateConnMapWithOffboardObstacleConnections({
            connMap: solver.connMap,
            connectionsWithResults: pathingSolver.connectionsWithResults,
            inputNodes: pathingSolver.inputNodes,
            obstacles: solver.srjWithPointPairs.obstacles,
          })
        },
      },
    ),
    // definePipelineStep(
    //   "multiSectionPortPointOptimizer",
    //   MultiSectionPortPointOptimizer,
    //   (solver) => {
    //     const portPointSolver = solver.portPointPathingSolver!
    //     return [
    //       {
    //         simpleRouteJson: solver.srjWithPointPairs,
    //         inputNodes: portPointSolver.inputNodes,
    //         capacityMeshNodes: solver.capacityNodes,
    //         capacityMeshEdges: solver.capacityEdges,
    //         colorMap: solver.colorMap,
    //         initialConnectionResults: portPointSolver.connectionsWithResults,
    //         initialAssignedPortPoints: portPointSolver.assignedPortPoints,
    //         initialNodeAssignedPortPoints:
    //           portPointSolver.nodeAssignedPortPoints,
    //       },
    //     ]
    //   },
    // ),
    definePipelineStep(
      "highDensitySolver",
      SimpleHighDensitySolver,
      (solver) => [
        {
          nodePortPoints:
            solver.multiSectionPortPointOptimizer?.getNodesWithPortPoints() ??
            solver.portPointPathingSolver?.getNodesWithPortPoints() ??
            [],
          colorMap: solver.colorMap,
          viaDiameter: 0.6,
          traceWidth: solver.traceWidth,
          connMap: solver.connMap,
        },
      ],
    ),
    definePipelineStep(
      "highDensityStitchSolver",
      MultipleHighDensityRouteStitchSolver,
      (solver) => [
        {
          connections: solver.connections,
          hdRoutes: solver.highDensitySolver!.routes,
          colorMap: solver.colorMap,
          layerCount: 1,
          defaultViaDiameter: 0.6,
        },
      ],
      {
        onSolved: (solver) => {
          solver._combineResults()
        },
      },
    ),
  ]

  constructor(params: JumperPrepatternSolverParams) {
    super()
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.jumperFootprint = params.jumperFootprint ?? "0805"
    this.hyperParameters = params.hyperParameters ?? {}
    this.MAX_ITERATIONS = 100_000

    // Generate jumpers first (before creating SimpleRouteJson since it needs the obstacles)
    this._generatePrepatternJumpers()

    // Initialize data before pipeline starts
    this.srjWithPointPairs = this._createSimpleRouteJson()
    this.connMap =
      params.connMap ??
      getConnectivityMapFromSimpleRouteJson(this.srjWithPointPairs)
    this.colorMap = getColorMap(this.srjWithPointPairs, this.connMap)
  }

  getCurrentStageName(): string {
    return this.pipelineDef[this.currentPipelineStepIndex]?.solverName ?? "done"
  }

  _step() {
    const pipelineStepDef = this.pipelineDef[this.currentPipelineStepIndex]
    if (!pipelineStepDef) {
      this.solved = true
      return
    }

    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.endTimeOfPhase[pipelineStepDef.solverName] = performance.now()
        this.timeSpentOnPhase[pipelineStepDef.solverName] =
          this.endTimeOfPhase[pipelineStepDef.solverName] -
          this.startTimeOfPhase[pipelineStepDef.solverName]
        pipelineStepDef.onSolved?.(this)
        this.activeSubSolver = null
        this.currentPipelineStepIndex++
      } else if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver?.error
        this.failed = true
        this.activeSubSolver = null
      }
      return
    }

    const constructorParams = pipelineStepDef.getConstructorParams(this)
    // @ts-ignore
    this.activeSubSolver = new pipelineStepDef.solverClass(...constructorParams)
    ;(this as any)[pipelineStepDef.solverName] = this.activeSubSolver
    this.timeSpentOnPhase[pipelineStepDef.solverName] = 0
    this.startTimeOfPhase[pipelineStepDef.solverName] = performance.now()
  }

  getCurrentPhase(): string {
    return this.pipelineDef[this.currentPipelineStepIndex]?.solverName ?? "done"
  }

  _createSimpleRouteJson(): SimpleRouteJson {
    // Extract connections from port points
    const connectionMap = new Map<
      string,
      {
        points: { x: number; y: number; z: number }[]
        rootConnectionName?: string
      }
    >()

    for (const pp of this.nodeWithPortPoints.portPoints) {
      const existing = connectionMap.get(pp.connectionName)
      if (existing) {
        existing.points.push({ x: pp.x, y: pp.y, z: pp.z })
      } else {
        connectionMap.set(pp.connectionName, {
          points: [{ x: pp.x, y: pp.y, z: pp.z }],
          rootConnectionName: pp.rootConnectionName,
        })
      }
    }

    this.connections = Array.from(connectionMap.entries()).map(
      ([name, data]) => ({
        name,
        rootConnectionName: data.rootConnectionName,
        pointsToConnect: data.points.map((p) => ({
          x: p.x,
          y: p.y,
          layer: "top" as const,
        })),
      }),
    )

    // Create obstacles for jumper pads
    const obstacles = this._createJumperPadObstacles()

    // Add obstacles for port points (the pads/pins that traces connect to)
    this._addPortPointObstacles(obstacles)

    const node = this.nodeWithPortPoints
    return {
      layerCount: 1,
      minTraceWidth: this.traceWidth,
      obstacles,
      connections: this.connections,
      bounds: {
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      },
    }
  }

  _createJumperPadObstacles(): SimpleRouteJson["obstacles"] {
    const obstacles: SimpleRouteJson["obstacles"] = []

    for (const jumper of this.prepatternJumpers) {
      const dims = JUMPER_DIMENSIONS[jumper.footprint]

      // Determine pad orientation based on jumper direction
      const dx = jumper.end.x - jumper.start.x
      const dy = jumper.end.y - jumper.start.y
      const isHorizontal = Math.abs(dx) > Math.abs(dy)

      const padWidth = isHorizontal ? dims.padLength : dims.padWidth
      const padHeight = isHorizontal ? dims.padWidth : dims.padLength

      // Start pad obstacle
      obstacles.push({
        type: "rect",
        obstacleId: `${jumper.jumperId}_pad_start`,
        layers: ["top"],
        center: { x: jumper.start.x, y: jumper.start.y },
        width: padWidth,
        height: padHeight,
        connectedTo: [],
        offBoardConnectsTo: [jumper.offBoardConnectionId],
      })

      // End pad obstacle
      obstacles.push({
        type: "rect",
        obstacleId: `${jumper.jumperId}_pad_end`,
        layers: ["top"],
        center: { x: jumper.end.x, y: jumper.end.y },
        width: padWidth,
        height: padHeight,
        connectedTo: [],
        offBoardConnectsTo: [jumper.offBoardConnectionId],
      })
    }

    return obstacles
  }

  _addPortPointObstacles(obstacles: SimpleRouteJson["obstacles"]) {
    // Add an obstacle for each port point so the autorouter knows
    // these are connection terminals that traces can connect to
    const padSize = this.traceWidth * 2

    for (const pp of this.nodeWithPortPoints.portPoints) {
      obstacles.push({
        type: "rect",
        obstacleId: `port_${pp.connectionName}_${pp.x.toFixed(3)}_${pp.y.toFixed(3)}`,
        layers: ["top"],
        center: { x: pp.x, y: pp.y },
        width: padSize,
        height: padSize,
        connectedTo: [pp.connectionName],
      })
    }
  }

  _generatePrepatternJumpers() {
    // Generate prepattern jumpers based on the node layout
    const node = this.nodeWithPortPoints
    const bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }

    const dims = JUMPER_DIMENSIONS[this.jumperFootprint]
    const jumperLength = dims.length
    const jumperSpacing = jumperLength * 2.5

    const numHorizontalJumpers = Math.floor(
      (bounds.maxX - bounds.minX - jumperLength) / jumperSpacing,
    )

    const rowSpacing = dims.width * 3
    const numRows = Math.floor(
      (bounds.maxY - bounds.minY - dims.width) / rowSpacing,
    )

    let jumperIndex = 0

    for (let row = 0; row < numRows; row++) {
      const y = bounds.minY + dims.width + row * rowSpacing
      const isOddRow = row % 2 === 1
      const startX =
        bounds.minX + jumperLength / 2 + (isOddRow ? jumperSpacing / 2 : 0)

      for (let col = 0; col < numHorizontalJumpers; col++) {
        const x = startX + col * jumperSpacing
        if (x + jumperLength / 2 > bounds.maxX) break

        const overlapsPortPoint = this._jumperOverlapsPortPoint(
          { x, y },
          { x: x + jumperLength, y },
        )

        if (!overlapsPortPoint) {
          const jumperId = `jumper_${jumperIndex}`
          const offBoardConnectionId = `jumper_conn_${jumperIndex}`

          this.prepatternJumpers.push({
            jumperId,
            start: { x, y },
            end: { x: x + jumperLength, y },
            footprint: this.jumperFootprint,
            offBoardConnectionId,
          })

          jumperIndex++
        }
      }
    }
  }

  _jumperOverlapsPortPoint(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): boolean {
    const dims = JUMPER_DIMENSIONS[this.jumperFootprint]
    const margin = dims.width / 2 + this.traceWidth * 2

    for (const pp of this.nodeWithPortPoints.portPoints) {
      const distToStart = distance(pp, start)
      if (distToStart < margin) return true

      const distToEnd = distance(pp, end)
      if (distToEnd < margin) return true
    }

    return false
  }

  _combineResults() {
    // Convert HD routes to routes with jumpers
    const finalRoutes =
      this.highDensityStitchSolver?.mergedHdRoutes ??
      this.highDensitySolver?.routes ??
      []

    for (const hdRoute of finalRoutes) {
      const routeJumpers = this._findJumpersForRoute(hdRoute)

      this.solvedRoutes.push({
        connectionName: hdRoute.connectionName,
        rootConnectionName: hdRoute.rootConnectionName,
        traceThickness: hdRoute.traceThickness,
        route: hdRoute.route,
        jumpers: routeJumpers,
      })
    }
  }

  _findJumpersForRoute(hdRoute: HighDensityIntraNodeRoute): Jumper[] {
    // For now, return empty - jumper assignment logic can be added later
    return []
  }

  getOutput(): HighDensityIntraNodeRouteWithJumpers[] {
    return this.solvedRoutes
  }

  /**
   * Draw the two pads of a jumper
   */
  private _drawJumperPads(
    graphics: GraphicsObject,
    jumper: {
      start: { x: number; y: number }
      end: { x: number; y: number }
      footprint: JumperFootprint
    },
    color: string,
  ) {
    const dims = JUMPER_DIMENSIONS[jumper.footprint]
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const rectWidth = isHorizontal ? dims.padLength : dims.padWidth
    const rectHeight = isHorizontal ? dims.padWidth : dims.padLength

    graphics.rects!.push({
      center: { x: jumper.start.x, y: jumper.start.y },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    graphics.rects!.push({
      center: { x: jumper.end.x, y: jumper.end.y },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    graphics.lines!.push({
      points: [jumper.start, jumper.end],
      strokeColor: "rgba(100, 100, 100, 0.8)",
      strokeWidth: dims.padWidth * 0.3,
      layer: "jumper-body",
    })
  }

  visualize(): GraphicsObject {
    if (!this.solved && this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    const bounds = {
      minX:
        this.nodeWithPortPoints.center.x - this.nodeWithPortPoints.width / 2,
      maxX:
        this.nodeWithPortPoints.center.x + this.nodeWithPortPoints.width / 2,
      minY:
        this.nodeWithPortPoints.center.y - this.nodeWithPortPoints.height / 2,
      maxY:
        this.nodeWithPortPoints.center.y + this.nodeWithPortPoints.height / 2,
    }

    graphics.lines!.push({
      points: [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    for (const pp of this.nodeWithPortPoints.portPoints) {
      graphics.points!.push({
        x: pp.x,
        y: pp.y,
        label: pp.connectionName,
        color: this.colorMap[pp.connectionName] ?? "blue",
      })
    }

    for (const jumper of this.prepatternJumpers) {
      this._drawJumperPads(graphics, jumper, "rgba(128, 128, 128, 0.5)")
    }

    for (const route of this.solvedRoutes) {
      const color = this.colorMap[route.connectionName] ?? "blue"

      for (let i = 0; i < route.route.length - 1; i++) {
        const p1 = route.route[i]
        const p2 = route.route[i + 1]

        graphics.lines!.push({
          points: [p1, p2],
          strokeColor: safeTransparentize(color, 0.2),
          strokeWidth: route.traceThickness,
          layer: "route-layer-0",
        })
      }

      for (const jumper of route.jumpers) {
        this._drawJumperPads(
          graphics,
          { ...jumper, footprint: jumper.footprint },
          safeTransparentize(color, 0.5),
        )
      }
    }

    graphics.points!.push({
      x: bounds.minX,
      y: bounds.maxY + 0.5,
      label: `Phase: ${this.getCurrentPhase()}`,
      color: "black",
    })

    return graphics
  }
}
