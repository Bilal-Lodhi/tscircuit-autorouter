import { CapacityMeshNode } from "lib/types"
import { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { Point } from "graphics-debug"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import {
  settings,
  connectionVariants,
  viaSizesVariants,
  traceWidthsVariants,
  layerVariation,
} from "./ml-data-collection-config"
import { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

const FEATURE_SCHEMA = {
  top_edge_ports_normalized_to_width: { useForGeometric: true },
  right_edge_ports_normalized_to_height: { useForGeometric: true },
  bottom_edge_ports_normalized_to_width: { useForGeometric: true },
  left_edge_ports_normalized_to_height: { useForGeometric: true },
  same_layer_crossings_normalized_to_area: { useForGeometric: false },
  same_layer_crossings_normalized_to_trace_width: { useForGeometric: false },
  entry_exit_layer_changes_normalized_to_area: { useForGeometric: false },
  entry_exit_layer_changes_normalized_to_trace_width: {
    useForGeometric: false,
  },
  transition_pair_crossings_normalized_to_area: { useForGeometric: false },
  transition_pair_crossings_normalized_to_trace_width: {
    useForGeometric: false,
  },
  single_via_area_normalized_to_area: { useForGeometric: true },
  two_via_area_normalized_to_area: { useForGeometric: true },
  board_aspect_ratio_not_normalized: { useForGeometric: true },
} as const

type FeatureKey = keyof typeof FEATURE_SCHEMA

export type Features = Record<FeatureKey, number> & {
  did_hight_density_solver_find_solution?: boolean
}

export type DatasetRow = Features & { cost: number }

type Candidate = {
  nodeWithPortPoints: NodeWithPortPoints
  node: CapacityMeshNode
  viaSize: number
  traceWidth: number
  layerCount: number
}

const safeDiv = (a: number, b: number) => {
  if (b <= 0) return 0
  return a / b
}

export const computeFeaturesForMl = (params: {
  node: InputNodeWithPortPoints
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionPairCrossings: number
  viaSize: number
  traceWidth: number
}): Features => {
  const area = Math.max(1, params.node.width * params.node.height)
  const viaArea = Math.max(1, Math.PI * (params.viaSize / 2) ** 2)

  let topPortCount = 0
  let bottomPortCount = 0
  let leftPortCount = 0
  let rightPortCount = 0

  const top_edge_ports_normalized_to_width = safeDiv(
    topPortCount * params.traceWidth,
    params.node.width,
  )
  const right_edge_ports_normalized_to_height = safeDiv(
    rightPortCount * params.traceWidth,
    params.node.height,
  )
  const bottom_edge_ports_normalized_to_width = safeDiv(
    bottomPortCount * params.traceWidth,
    params.node.width,
  )
  const left_edge_ports_normalized_to_height = safeDiv(
    leftPortCount * params.traceWidth,
    params.node.height,
  )

  const same_layer_crossings_normalized_to_area = safeDiv(
    params.numSameLayerCrossings,
    area,
  )
  const same_layer_crossings_normalized_to_trace_width = safeDiv(
    params.numSameLayerCrossings,
    params.traceWidth,
  )
  const entry_exit_layer_changes_normalized_to_area = safeDiv(
    params.numEntryExitLayerChanges,
    area,
  )
  const entry_exit_layer_changes_normalized_to_trace_width = safeDiv(
    params.numEntryExitLayerChanges,
    params.traceWidth,
  )
  const transition_pair_crossings_normalized_to_area = safeDiv(
    params.numTransitionPairCrossings,
    area,
  )
  const transition_pair_crossings_normalized_to_trace_width = safeDiv(
    params.numTransitionPairCrossings,
    params.traceWidth,
  )

  const single_via_occupancy_normalized_to_area = safeDiv(viaArea, area)
  const two_via_occupancy_normalized_to_area = safeDiv(viaArea * 2, area)
  const board_aspect_ratio_not_normalized = safeDiv(
    params.node.width,
    params.node.height,
  )

  return {
    top_edge_ports_normalized_to_width,
    right_edge_ports_normalized_to_height,
    bottom_edge_ports_normalized_to_width,
    left_edge_ports_normalized_to_height,
    same_layer_crossings_normalized_to_area,
    same_layer_crossings_normalized_to_trace_width,
    entry_exit_layer_changes_normalized_to_area,
    entry_exit_layer_changes_normalized_to_trace_width,
    transition_pair_crossings_normalized_to_area,
    transition_pair_crossings_normalized_to_trace_width,
    single_via_area_normalized_to_area: single_via_occupancy_normalized_to_area,
    two_via_area_normalized_to_area: two_via_occupancy_normalized_to_area,
    board_aspect_ratio_not_normalized,
  }
}

const generateRandomPortPoints = (
  numConnections: number,
  node: CapacityMeshNode,
  availableZ: number[],
): NodeWithPortPoints["portPoints"] => {
  const portPoints: NodeWithPortPoints["portPoints"] = []
  const edges = ["top", "right", "bottom", "left"] as const
  const halfW = node.width / 2
  const halfH = node.height / 2

  for (let i = 0; i < numConnections; i++) {
    const connectionName = `net_${i}`
    const numPorts = Math.floor(Math.random() * 3) + 2

    for (let j = 0; j < numPorts; j++) {
      const edge = edges[Math.floor(Math.random() * edges.length)]
      const z = availableZ[Math.floor(Math.random() * availableZ.length)]

      let x = node.center.x
      let y = node.center.y

      if (edge === "top") {
        y = node.center.y + halfH
        x = node.center.x + (Math.random() - 0.5) * node.width
      } else if (edge === "bottom") {
        y = node.center.y - halfH
        x = node.center.x + (Math.random() - 0.5) * node.width
      } else if (edge === "left") {
        x = node.center.x - halfW
        y = node.center.y + (Math.random() - 0.5) * node.height
      } else {
        x = node.center.x + halfW
        y = node.center.y + (Math.random() - 0.5) * node.height
      }

      portPoints.push({
        connectionName,
        x,
        y,
        z,
      })
    }
  }

  return portPoints
}

const randomChoice = <T>(values: T[]): T => {
  const index = Math.floor(Math.random() * values.length)
  return values[index]
}

export const generateRandomCandidate = (): Candidate => {
  const setting = randomChoice(settings)
  const numConnections = randomChoice(connectionVariants)
  const viaSize = randomChoice(viaSizesVariants)
  const traceWidth = randomChoice(traceWidthsVariants)
  const layerCount = randomChoice(layerVariation)
  const availableZ = Array.from({ length: layerCount }, (_, index) => index)

  const node: CapacityMeshNode = {
    capacityMeshNodeId: `node_${Math.random().toString(36).slice(2)}`,
    center: { x: 0, y: 0 },
    width: setting.width,
    height: setting.height,
    layer: "top",
    availableZ,
  }

  const portPoints = generateRandomPortPoints(numConnections, node, availableZ)

  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: node.capacityMeshNodeId,
    center: node.center,
    width: node.width,
    height: node.height,
    portPoints,
    availableZ,
  }

  return {
    nodeWithPortPoints,
    node,
    viaSize,
    traceWidth,
    layerCount,
  }
}

export const evaluateCandidate = (candidate: Candidate): DatasetRow => {
  const { nodeWithPortPoints, viaSize, traceWidth } = candidate

  const {
    numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionPairCrossings,
  } = getIntraNodeCrossings(nodeWithPortPoints)

  const inputNode: InputNodeWithPortPoints = {
    capacityMeshNodeId: nodeWithPortPoints.capacityMeshNodeId,
    center: nodeWithPortPoints.center,
    width: nodeWithPortPoints.width,
    height: nodeWithPortPoints.height,
    // For ML features, we only need geometry and availableZ.
    // PortPointPathingSolver provides real portPoints; here we use an empty set.
    portPoints: [],
    availableZ: nodeWithPortPoints.availableZ ?? [],
  }

  const features = computeFeaturesForMl({
    node: inputNode,
    numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionPairCrossings,
    viaSize,
    traceWidth,
  })

  const cost =
    numSameLayerCrossings +
    numEntryExitLayerChanges +
    numTransitionPairCrossings

  const hdSolver = new HighDensitySolver({
    nodePortPoints: [nodeWithPortPoints],
    viaDiameter: viaSize,
    traceWidth,
  })

  hdSolver.MAX_ITERATIONS = 20000

  hdSolver.solve()

  return {
    ...features,
    cost,
    did_hight_density_solver_find_solution: hdSolver.solved,
  }
}
