#!/usr/bin/env bun

import fs from "node:fs"
import path from "node:path"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import {
  createGraphicsGrid,
  getPngBufferFromGraphicsObject,
  mergeGraphics,
  stackGraphicsHorizontally,
  stackGraphicsVertically,
  type GraphicsObject,
  type Viewbox,
} from "graphics-debug"
import { AutoroutingPipelineSolver4 } from "../lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { safeTransparentize } from "../lib/solvers/colors"
import { RELAXED_DRC_OPTIONS } from "../lib/testing/drcPresets"
import { getDrcErrors } from "../lib/testing/getDrcErrors"
import { convertToCircuitJson } from "../lib/testing/utils/convertToCircuitJson"
import type { HighDensityRoute } from "../lib/types/high-density-types"
import type { SimpleRouteJson } from "../lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "../lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "../lib/utils/convertSrjToGraphicsObject"

type InvestigationSummary = {
  scenarioName: string
  didSolve: boolean
  rawHdRouteCount: number
  nodeForceChangedRouteCount: number
  nodeForceSampleCount: number
  nodeForceImprovedNodeCount: number
  nodeForceRepairedNodeCount: number
  repairChangedRouteCount: number
  relaxedDrcErrorCount: number
  relaxedDrcPassed: boolean
  outputPngPath: string
  errorSummaries: ErrorWindowSummary[]
}

type ErrorWindowSummary = {
  errorIndex: number
  message: string
  center: { x: number; y: number }
  closeupPngPath: string
  closeupWindow: Viewbox
  stageWindowErrorCounts: Record<StageKey, number>
  candidateNodes: CandidateNodeSummary[]
}

type StageKey = "highDensity" | "nodeForce" | "repair02" | "final"

type StageRenderData = {
  key: StageKey
  title: string
  srj: SimpleRouteJson
  graphics: GraphicsObject
  drc: ReturnType<typeof getDrcErrors>
}

type CandidateNodeSummary = {
  nodeId: string
  center: { x: number; y: number }
  width: number
  height: number
  containsErrorCenter: boolean
  intersectsWindow: boolean
  localRouteCount: number
  localChangedRouteCount: number
  selectedStage: string
  repaired: boolean
  improved: boolean
  issueCountDelta: number
  originalIssueCount: number
  finalIssueCount: number
}

const DEFAULT_SCENARIOS = ["circuit002", "circuit015", "circuit102"]
const DEFAULT_OUT_DIR = path.join(
  process.cwd(),
  "tmp",
  "pipeline4-force-investigation",
)
const CLOSEUP_WINDOW_SIZE = 8
const NODE_HIGHLIGHT_MARGIN = 0.35

const args = process.argv.slice(2)
const scenarioNames = args.length > 0 ? args : DEFAULT_SCENARIOS

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true })

const routeFingerprint = (route: HighDensityRoute | undefined) =>
  JSON.stringify({
    route: route?.route ?? [],
    vias: route?.vias ?? [],
    jumpers: route?.jumpers ?? [],
  })

const countChangedRoutes = (
  left: HighDensityRoute[],
  right: HighDensityRoute[],
): number => {
  let changedRouteCount = 0

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const leftRoute = left[i]
    const rightRoute = right[i]
    if (routeFingerprint(leftRoute) !== routeFingerprint(rightRoute)) {
      changedRouteCount += 1
    }
  }

  return changedRouteCount
}

const createHdRouteGraphics = (
  routes: HighDensityRoute[],
  colorMap: Record<string, string>,
): GraphicsObject => {
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const circles: NonNullable<GraphicsObject["circles"]> = []

  for (const route of routes) {
    const strokeColor = colorMap[route.connectionName] ?? "#0ea5e9"
    for (let i = 0; i < route.route.length - 1; i += 1) {
      const start = route.route[i]
      const end = route.route[i + 1]
      if (start.z !== end.z) continue

      lines.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor:
          start.z === 0 ? strokeColor : safeTransparentize(strokeColor, 0.5),
        strokeWidth: route.traceThickness,
        layer: `z${start.z}`,
        strokeDash: start.z !== 0 ? [0.1, 0.3] : undefined,
      })
    }

    for (const via of route.vias) {
      circles.push({
        center: { x: via.x, y: via.y },
        radius: route.viaDiameter / 2,
        stroke: strokeColor,
        fill: "rgba(14,165,233,0.12)",
      })
    }
  }

  return { lines, circles }
}

const createDrcOverlay = (
  locationAwareErrors: ReturnType<typeof getDrcErrors>["locationAwareErrors"],
  color = "red",
): GraphicsObject => ({
  circles: locationAwareErrors.map((error) => ({
    center: error.center,
    radius: 0.75,
    fill:
      color === "red"
        ? "rgba(255, 0, 0, 0.22)"
        : color === "orange"
          ? "rgba(245, 158, 11, 0.22)"
          : "rgba(59, 130, 246, 0.18)",
    layer: "drc",
    stroke: color,
    strokeWidth: 0.1,
    label: error.message,
  })),
  points: locationAwareErrors.map((error) => ({
    x: error.center.x,
    y: error.center.y,
    color,
    layer: "drc",
    label: error.message,
  })),
  lines: locationAwareErrors.flatMap((error) => [
    {
      points: [
        { x: error.center.x - 0.5, y: error.center.y - 0.5 },
        { x: error.center.x + 0.5, y: error.center.y + 0.5 },
      ],
      layer: "drc",
      strokeColor: color,
      strokeWidth: 0.08,
    },
    {
      points: [
        { x: error.center.x - 0.5, y: error.center.y + 0.5 },
        { x: error.center.x + 0.5, y: error.center.y - 0.5 },
      ],
      layer: "drc",
      strokeColor: color,
      strokeWidth: 0.08,
    },
  ]),
})

const createPinnedErrorOverlay = (
  center: { x: number; y: number },
  label: string,
): GraphicsObject => ({
  circles: [
    {
      center,
      radius: 1.05,
      fill: "rgba(255, 0, 0, 0.08)",
      stroke: "#dc2626",
      layer: "drc-focus",
      label,
    },
    {
      center,
      radius: 0.28,
      fill: "#dc2626",
      stroke: "#7f1d1d",
      layer: "drc-focus",
      label,
    },
  ],
  lines: [
    {
      points: [
        { x: center.x - 0.75, y: center.y },
        { x: center.x + 0.75, y: center.y },
      ],
      strokeColor: "#dc2626",
      strokeWidth: 0.08,
      layer: "drc-focus",
      label,
    },
    {
      points: [
        { x: center.x, y: center.y - 0.75 },
        { x: center.x, y: center.y + 0.75 },
      ],
      strokeColor: "#dc2626",
      strokeWidth: 0.08,
      layer: "drc-focus",
      label,
    },
  ],
})

const addStatsText = (
  graphic: GraphicsObject,
  srj: SimpleRouteJson,
  lines: string[],
): GraphicsObject => {
  const lineHeight = 1.3
  return mergeGraphics(graphic, {
    texts: lines.map((text, index) => ({
      x: srj.bounds.minX,
      y: srj.bounds.maxY + 1.5 + index * lineHeight,
      text,
      anchorSide: "top_left",
      color: "black",
      fontSize: 0.9,
    })),
  })
}

const createProblemGraphic = (srj: SimpleRouteJson) =>
  convertSrjToGraphicsObject({ ...srj, traces: [] })

const toViewbox = (
  center: { x: number; y: number },
  size: number,
): Viewbox => ({
  minX: center.x - size / 2,
  maxX: center.x + size / 2,
  minY: center.y - size / 2,
  maxY: center.y + size / 2,
})

const expandViewbox = (viewbox: Viewbox, margin: number): Viewbox => ({
  minX: viewbox.minX - margin,
  maxX: viewbox.maxX + margin,
  minY: viewbox.minY - margin,
  maxY: viewbox.maxY + margin,
})

const doesViewboxOverlap = (a: Viewbox, b: Viewbox) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

const getPointsBounds = (
  points: Array<{ x: number; y: number }>,
): Viewbox | null => {
  if (points.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return { minX, minY, maxX, maxY }
}

const cropGraphicsToViewbox = (
  graphics: GraphicsObject,
  viewbox: Viewbox,
): GraphicsObject => ({
  ...graphics,
  points: graphics.points?.filter(
    (point) =>
      point.x >= viewbox.minX &&
      point.x <= viewbox.maxX &&
      point.y >= viewbox.minY &&
      point.y <= viewbox.maxY,
  ),
  lines: graphics.lines?.filter((line) => {
    const bounds = getPointsBounds(line.points)
    return bounds ? doesViewboxOverlap(bounds, viewbox) : false
  }),
  infiniteLines: graphics.infiniteLines,
  rects: graphics.rects?.filter((rect) =>
    doesViewboxOverlap(
      {
        minX: rect.center.x - rect.width / 2,
        maxX: rect.center.x + rect.width / 2,
        minY: rect.center.y - rect.height / 2,
        maxY: rect.center.y + rect.height / 2,
      },
      viewbox,
    ),
  ),
  circles: graphics.circles?.filter((circle) =>
    doesViewboxOverlap(
      {
        minX: circle.center.x - circle.radius,
        maxX: circle.center.x + circle.radius,
        minY: circle.center.y - circle.radius,
        maxY: circle.center.y + circle.radius,
      },
      viewbox,
    ),
  ),
  polygons: graphics.polygons?.filter((polygon) => {
    const bounds = getPointsBounds(polygon.points)
    return bounds ? doesViewboxOverlap(bounds, viewbox) : false
  }),
  arrows: graphics.arrows?.filter((arrow) =>
    doesViewboxOverlap(
      {
        minX: Math.min(arrow.start.x, arrow.end.x),
        maxX: Math.max(arrow.start.x, arrow.end.x),
        minY: Math.min(arrow.start.y, arrow.end.y),
        maxY: Math.max(arrow.start.y, arrow.end.y),
      },
      viewbox,
    ),
  ),
  texts: graphics.texts?.filter(
    (text) =>
      text.x >= viewbox.minX &&
      text.x <= viewbox.maxX &&
      text.y >= viewbox.minY &&
      text.y <= viewbox.maxY,
  ),
})

const hdRouteIntersectsViewbox = (
  route: HighDensityRoute,
  viewbox: Viewbox,
): boolean => {
  const routeBounds = getPointsBounds(route.route)
  const viaBounds = getPointsBounds(route.vias)
  return Boolean(
    (routeBounds && doesViewboxOverlap(routeBounds, viewbox)) ||
      (viaBounds && doesViewboxOverlap(viaBounds, viewbox)),
  )
}

const buildStageTraces = (
  pipeline: AutoroutingPipelineSolver4,
  hdRoutes: HighDensityRoute[],
) => {
  const traces = []
  for (const connection of pipeline.netToPointPairsSolver?.newConnections ??
    []) {
    const netConnectionName =
      connection.netConnectionName ??
      pipeline.srj.connections.find((c) => c.name === connection.name)
        ?.netConnectionName

    const connectionHdRoutes = hdRoutes.filter(
      (route) => route.connectionName === connection.name,
    )

    for (let i = 0; i < connectionHdRoutes.length; i += 1) {
      const hdRoute = connectionHdRoutes[i]
      traces.push({
        type: "pcb_trace" as const,
        pcb_trace_id: `${connection.name}_${i}`,
        connection_name:
          netConnectionName ?? connection.rootConnectionName ?? connection.name,
        route: convertHdRouteToSimplifiedRoute(
          hdRoute,
          pipeline.srj.layerCount,
        ),
      })
    }
  }
  return traces
}

const buildStageRenderData = (params: {
  key: StageKey
  title: string
  pipeline: AutoroutingPipelineSolver4
  hdRoutes?: HighDensityRoute[]
  srj?: SimpleRouteJson
}): StageRenderData => {
  const { key, title, pipeline } = params
  const srj =
    params.srj ??
    ({
      ...pipeline.srj,
      traces: buildStageTraces(pipeline, params.hdRoutes ?? []),
    } satisfies SimpleRouteJson)
  const circuitJson = convertToCircuitJson(
    pipeline.srjWithPointPairs ?? pipeline.srj,
    srj.traces ?? [],
    pipeline.srj.minTraceWidth,
  )
  return {
    key,
    title,
    srj,
    graphics: convertSrjToGraphicsObject(srj),
    drc: getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS),
  }
}

const createNodeOverlay = (params: {
  candidateNodes: CandidateNodeSummary[]
}): GraphicsObject => ({
  rects: params.candidateNodes.map((node, index) => ({
    center: node.center,
    width: node.width + NODE_HIGHLIGHT_MARGIN * 2,
    height: node.height + NODE_HIGHLIGHT_MARGIN * 2,
    fill: index === 0 ? "rgba(245, 158, 11, 0.08)" : "rgba(59, 130, 246, 0.06)",
    stroke: index === 0 ? "#f59e0b" : "#2563eb",
    layer: "candidate-node",
    label: `${node.nodeId}\n${node.selectedStage}\nchanged=${node.localChangedRouteCount}/${node.localRouteCount}`,
  })),
})

const createHeaderGraphic = (
  lines: string[],
  viewbox: Viewbox,
): GraphicsObject => ({
  texts: lines.map((text, index) => ({
    x: viewbox.minX,
    y: viewbox.maxY + 0.55 + index * 0.42,
    text,
    anchorSide: "top_left",
    color: "#111827",
    fontSize: 0.33,
  })),
})

const getScenario = (scenarioName: string): SimpleRouteJson => {
  const value = (dataset01 as Record<string, unknown>)[scenarioName]
  if (!value || typeof value !== "object") {
    throw new Error(`Unknown scenario: ${scenarioName}`)
  }
  return structuredClone(value as SimpleRouteJson)
}

const renderScenario = async (
  scenarioName: string,
  outDir: string,
): Promise<InvestigationSummary> => {
  const srj = getScenario(scenarioName)
  const pipeline = new AutoroutingPipelineSolver4(srj)
  pipeline.solve()

  if (!pipeline.solved || pipeline.failed) {
    throw new Error(
      `Pipeline4 did not solve ${scenarioName}: ${pipeline.error ?? "unknown error"}`,
    )
  }

  const rawHdRoutes = pipeline.highDensityRouteSolver?.routes ?? []
  const nodeForceRoutes =
    pipeline.highDensityNodeForceImprovementSolver?.getOutput() ?? rawHdRoutes
  const repairedRoutes =
    pipeline.highDensityRepairSolver?.getOutput() ?? nodeForceRoutes
  const finalSrj = pipeline.getOutputSimpleRouteJson()

  const stageData = {
    highDensity: buildStageRenderData({
      key: "highDensity",
      title: "HighDensity",
      pipeline,
      hdRoutes: rawHdRoutes,
    }),
    nodeForce: buildStageRenderData({
      key: "nodeForce",
      title: "NodeForceImprovement",
      pipeline,
      hdRoutes: nodeForceRoutes,
    }),
    repair02: buildStageRenderData({
      key: "repair02",
      title: "Repair02",
      pipeline,
      hdRoutes: repairedRoutes,
    }),
    final: buildStageRenderData({
      key: "final",
      title: "Final + Relaxed DRC",
      pipeline,
      srj: finalSrj,
    }),
  } satisfies Record<StageKey, StageRenderData>

  const nodeForceChangedRouteCount = countChangedRoutes(
    rawHdRoutes,
    nodeForceRoutes,
  )
  const repairChangedRouteCount = countChangedRoutes(
    nodeForceRoutes,
    repairedRoutes,
  )

  const problemGraphic = createProblemGraphic(srj)

  const rawGraphic = addStatsText(
    mergeGraphics(
      problemGraphic,
      createHdRouteGraphics(rawHdRoutes, pipeline.colorMap),
      createDrcOverlay(stageData.highDensity.drc.locationAwareErrors, "orange"),
    ),
    srj,
    [
      `routes=${rawHdRoutes.length}`,
      `relaxedDrc=${stageData.highDensity.drc.errors.length}`,
    ],
  )
  const nodeForceGraphic = addStatsText(
    mergeGraphics(
      problemGraphic,
      createHdRouteGraphics(nodeForceRoutes, pipeline.colorMap),
      createDrcOverlay(stageData.nodeForce.drc.locationAwareErrors, "orange"),
    ),
    srj,
    [
      `changedRoutes=${nodeForceChangedRouteCount}`,
      `samples=${pipeline.highDensityNodeForceImprovementSolver?.sampleEntries.length ?? 0}`,
      `improvedNodes=${pipeline.highDensityNodeForceImprovementSolver?.stats.improvedNodeCount ?? 0}`,
      `repairedNodes=${pipeline.highDensityNodeForceImprovementSolver?.stats.repairedNodeCount ?? 0}`,
      `relaxedDrc=${stageData.nodeForce.drc.errors.length}`,
    ],
  )
  const repairGraphic = addStatsText(
    mergeGraphics(
      problemGraphic,
      createHdRouteGraphics(repairedRoutes, pipeline.colorMap),
      createDrcOverlay(stageData.repair02.drc.locationAwareErrors, "orange"),
    ),
    srj,
    [
      `changedVsNodeForce=${repairChangedRouteCount}`,
      `relaxedDrc=${stageData.repair02.drc.errors.length}`,
    ],
  )
  const finalGraphic = addStatsText(
    mergeGraphics(
      convertSrjToGraphicsObject(finalSrj),
      createDrcOverlay(stageData.final.drc.locationAwareErrors),
    ),
    srj,
    [
      `relaxedDrcPassed=${stageData.final.drc.errors.length === 0}`,
      `relaxedDrcErrors=${stageData.final.drc.errors.length}`,
    ],
  )

  const topRow = stackGraphicsHorizontally([rawGraphic, nodeForceGraphic], {
    titles: ["HighDensity", "NodeForceImprovement"],
  })
  const bottomRow = stackGraphicsHorizontally([repairGraphic, finalGraphic], {
    titles: ["Repair02", "Final + Relaxed DRC"],
  })
  const pageGraphic = stackGraphicsVertically([topRow, bottomRow], {
    titles: [`${scenarioName} top`, `${scenarioName} bottom`],
  })

  const png = await getPngBufferFromGraphicsObject(pageGraphic, {
    pngWidth: 2200,
    pngHeight: 1800,
    includeTextLabels: false,
    backgroundColor: "white",
    padding: 20,
  })

  ensureDir(outDir)
  const outputPngPath = path.join(
    outDir,
    `${scenarioName}-pipeline4-stages.png`,
  )
  fs.writeFileSync(outputPngPath, png)

  const errorSummaries: ErrorWindowSummary[] = []
  const errorOutDir = path.join(outDir, scenarioName)
  ensureDir(errorOutDir)

  for (const [
    errorIndex,
    error,
  ] of stageData.final.drc.locationAwareErrors.entries()) {
    const closeupWindow = toViewbox(error.center, CLOSEUP_WINDOW_SIZE)
    const forceSolver = pipeline.highDensityNodeForceImprovementSolver
    const candidateNodes =
      forceSolver?.sampleEntries
        .map((sampleEntry) => {
          const nodeViewbox = expandViewbox(
            {
              minX: sampleEntry.node.center.x - sampleEntry.node.width / 2,
              maxX: sampleEntry.node.center.x + sampleEntry.node.width / 2,
              minY: sampleEntry.node.center.y - sampleEntry.node.height / 2,
              maxY: sampleEntry.node.center.y + sampleEntry.node.height / 2,
            },
            NODE_HIGHLIGHT_MARGIN,
          )
          const containsErrorCenter =
            error.center.x >= nodeViewbox.minX &&
            error.center.x <= nodeViewbox.maxX &&
            error.center.y >= nodeViewbox.minY &&
            error.center.y <= nodeViewbox.maxY
          const intersectsWindow = doesViewboxOverlap(
            nodeViewbox,
            closeupWindow,
          )
          const localRouteIndexes = sampleEntry.routeIndexes.filter(
            (routeIndex) =>
              hdRouteIntersectsViewbox(rawHdRoutes[routeIndex]!, closeupWindow),
          )
          const repairResult = forceSolver.repairResultsByNodeId.get(
            sampleEntry.node.capacityMeshNodeId,
          )
          if (
            !containsErrorCenter &&
            !intersectsWindow &&
            localRouteIndexes.length === 0
          ) {
            return null
          }
          return {
            nodeId: sampleEntry.node.capacityMeshNodeId,
            center: sampleEntry.node.center,
            width: sampleEntry.node.width,
            height: sampleEntry.node.height,
            containsErrorCenter,
            intersectsWindow,
            localRouteCount: localRouteIndexes.length,
            localChangedRouteCount: localRouteIndexes.filter(
              (routeIndex) =>
                routeFingerprint(rawHdRoutes[routeIndex]) !==
                routeFingerprint(nodeForceRoutes[routeIndex]),
            ).length,
            selectedStage: repairResult?.selectedStage ?? "not-sampled",
            repaired: repairResult?.repaired ?? false,
            improved: repairResult?.improved ?? false,
            issueCountDelta: repairResult?.issueCountDelta ?? 0,
            originalIssueCount: repairResult?.originalDrc.issues.length ?? 0,
            finalIssueCount: repairResult?.finalDrc.issues.length ?? 0,
          } satisfies CandidateNodeSummary
        })
        .filter((value): value is CandidateNodeSummary => value !== null)
        .sort((left, right) => {
          const leftScore =
            (left.containsErrorCenter ? 100 : 0) +
            (left.intersectsWindow ? 10 : 0) +
            left.localRouteCount
          const rightScore =
            (right.containsErrorCenter ? 100 : 0) +
            (right.intersectsWindow ? 10 : 0) +
            right.localRouteCount
          return rightScore - leftScore
        }) ?? []

    const stageWindowErrorCounts = Object.fromEntries(
      (Object.keys(stageData) as StageKey[]).map((stageKey) => [
        stageKey,
        stageData[stageKey].drc.locationAwareErrors.filter(
          (stageError) =>
            stageError.center.x >= closeupWindow.minX &&
            stageError.center.x <= closeupWindow.maxX &&
            stageError.center.y >= closeupWindow.minY &&
            stageError.center.y <= closeupWindow.maxY,
        ).length,
      ]),
    ) as Record<StageKey, number>

    const stagePanels = (Object.keys(stageData) as StageKey[]).map(
      (stageKey) => {
        const stage = stageData[stageKey]
        return mergeGraphics(
          cropGraphicsToViewbox(
            mergeGraphics(
              stage.graphics,
              createDrcOverlay(stage.drc.locationAwareErrors, "orange"),
              createPinnedErrorOverlay(error.center, error.message),
              createNodeOverlay({
                candidateNodes,
              }),
            ),
            closeupWindow,
          ),
          createHeaderGraphic(
            [
              `${stage.title} localDrc=${stageWindowErrorCounts[stageKey]} totalDrc=${stage.drc.errors.length}`,
            ],
            closeupWindow,
          ),
        )
      },
    )

    const grid = createGraphicsGrid(
      [stagePanels.slice(2, 4), stagePanels.slice(0, 2)],
      {
        gap: 1.5,
      },
    )
    const closeupGraphic = stackGraphicsVertically([
      grid,
      createHeaderGraphic(
        [
          `${scenarioName} error #${errorIndex + 1}`,
          error.message,
          candidateNodes.length > 0
            ? `candidateNodes=${candidateNodes
                .slice(0, 4)
                .map(
                  (node) =>
                    `${node.nodeId}[${node.selectedStage}; repaired=${node.repaired}; changed=${node.localChangedRouteCount}/${node.localRouteCount}]`,
                )
                .join(" | ")}`
            : "candidateNodes=none",
        ],
        {
          minX: 0,
          maxX: 12,
          minY: 0,
          maxY: 1,
        },
      ),
    ])

    const closeupPngPath = path.join(
      errorOutDir,
      `${scenarioName}-error-${String(errorIndex + 1).padStart(2, "0")}.png`,
    )
    const closeupPng = await getPngBufferFromGraphicsObject(closeupGraphic, {
      pngWidth: 2200,
      pngHeight: 1700,
      includeTextLabels: false,
      backgroundColor: "white",
      padding: 16,
    })
    fs.writeFileSync(closeupPngPath, closeupPng)

    errorSummaries.push({
      errorIndex: errorIndex + 1,
      message: error.message,
      center: error.center,
      closeupPngPath,
      closeupWindow,
      stageWindowErrorCounts,
      candidateNodes,
    })
  }

  return {
    scenarioName,
    didSolve: pipeline.solved && !pipeline.failed,
    rawHdRouteCount: rawHdRoutes.length,
    nodeForceChangedRouteCount,
    nodeForceSampleCount:
      pipeline.highDensityNodeForceImprovementSolver?.sampleEntries.length ?? 0,
    nodeForceImprovedNodeCount:
      pipeline.highDensityNodeForceImprovementSolver?.stats.improvedNodeCount ??
      0,
    nodeForceRepairedNodeCount:
      pipeline.highDensityNodeForceImprovementSolver?.stats.repairedNodeCount ??
      0,
    repairChangedRouteCount,
    relaxedDrcErrorCount: stageData.final.drc.errors.length,
    relaxedDrcPassed: stageData.final.drc.errors.length === 0,
    outputPngPath,
    errorSummaries,
  }
}

const main = async () => {
  ensureDir(DEFAULT_OUT_DIR)

  const summaries: InvestigationSummary[] = []
  for (const scenarioName of scenarioNames) {
    summaries.push(await renderScenario(scenarioName, DEFAULT_OUT_DIR))
  }

  const summaryPath = path.join(DEFAULT_OUT_DIR, "summary.json")
  fs.writeFileSync(summaryPath, JSON.stringify(summaries, null, 2))
  console.log(JSON.stringify({ summaryPath, summaries }, null, 2))
}

await main()
