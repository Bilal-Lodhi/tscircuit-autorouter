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
import {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

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
  // New crossing aggregation features (bounded to [0, 1])
  total_crossings_normalized_to_area: { useForGeometric: false },
  total_crossings_normalized_to_trace_width: { useForGeometric: false },
  same_layer_crossings_fraction_of_total: { useForGeometric: false },
  entry_exit_layer_changes_fraction_of_total: { useForGeometric: false },
  transition_pair_crossings_fraction_of_total: { useForGeometric: false },
  // New geometry/size features (all in [0, 1])
  width_normalized_to_max_side: { useForGeometric: true },
  height_normalized_to_max_side: { useForGeometric: true },
  trace_width_normalized_to_min_side: { useForGeometric: true },
  via_diameter_normalized_to_min_side: { useForGeometric: true },
  // New congestion features based on existing/partial paths
  existing_connection_points_normalized_to_perimeter: {
    useForGeometric: true,
  },
  already_connected_points_normalized_to_perimeter: {
    useForGeometric: true,
  },
  fraction_of_existing_connections_touching_node: {
    useForGeometric: false,
  },
  fraction_of_current_connection_already_in_node: {
    useForGeometric: false,
  },
  // Additional occupancy / layer-usage features
  existing_connection_points_normalized_to_area: {
    useForGeometric: true,
  },
  already_connected_points_normalized_to_area: {
    useForGeometric: true,
  },
  max_existing_connection_points_normalized_to_perimeter: {
    useForGeometric: true,
  },
  already_connected_points_fraction_of_existing_points_in_node: {
    useForGeometric: false,
  },
  existing_points_fraction_on_primary_layer: {
    useForGeometric: false,
  },
  already_connected_points_fraction_on_primary_layer: {
    useForGeometric: false,
  },
  existing_layers_fraction_used_in_node: {
    useForGeometric: false,
  },
  already_connected_layers_fraction_used_in_node: {
    useForGeometric: false,
  },
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
  connectionsWithResults?: ConnectionPathResult[]
  alreadyConnectedPath?: PortPoint[]
}): Features => {
  const area = Math.max(1, params.node.width * params.node.height)
  const viaArea = Math.max(1, Math.PI * (params.viaSize / 2) ** 2)

  // Edge port counts (kept as placeholders for now; can be
  // filled in using params.node.portPoints when desired)
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

  // Crossing-normalized features
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

  const totalCrossings =
    params.numSameLayerCrossings +
    params.numEntryExitLayerChanges +
    params.numTransitionPairCrossings

  // Clamp the total-crossings normalizations into [0, 1] so they
  // stay on a similar scale to the other features
  const total_crossings_normalized_to_area = Math.min(
    1,
    safeDiv(totalCrossings, area),
  )
  const total_crossings_normalized_to_trace_width = Math.min(
    1,
    safeDiv(totalCrossings, params.traceWidth),
  )

  const same_layer_crossings_fraction_of_total = safeDiv(
    params.numSameLayerCrossings,
    totalCrossings,
  )
  const entry_exit_layer_changes_fraction_of_total = safeDiv(
    params.numEntryExitLayerChanges,
    totalCrossings,
  )
  const transition_pair_crossings_fraction_of_total = safeDiv(
    params.numTransitionPairCrossings,
    totalCrossings,
  )

  // Via occupancy
  const single_via_occupancy_normalized_to_area = safeDiv(viaArea, area)
  const two_via_occupancy_normalized_to_area = safeDiv(viaArea * 2, area)

  // Geometry-scaled features
  const maxSide = Math.max(params.node.width, params.node.height, 1)
  const minSide = Math.max(1, Math.min(params.node.width, params.node.height))

  const width_normalized_to_max_side = safeDiv(params.node.width, maxSide)
  const height_normalized_to_max_side = safeDiv(params.node.height, maxSide)

  const trace_width_normalized_to_min_side = Math.min(
    1,
    safeDiv(params.traceWidth, minSide),
  )
  const via_diameter_normalized_to_min_side = Math.min(
    1,
    safeDiv(params.viaSize, minSide),
  )

  const board_aspect_ratio_not_normalized = safeDiv(
    params.node.width,
    params.node.height,
  )

  // --- Congestion-style features from existing/partial paths ---
  const nodeMinX = params.node.center.x - params.node.width / 2
  const nodeMaxX = params.node.center.x + params.node.width / 2
  const nodeMinY = params.node.center.y - params.node.height / 2
  const nodeMaxY = params.node.center.y + params.node.height / 2

  const isPointInNode = (p: { x: number; y: number }) =>
    p.x >= nodeMinX && p.x <= nodeMaxX && p.y >= nodeMinY && p.y <= nodeMaxY

  const nodePerimeter = Math.max(
    1,
    2 * (params.node.width + params.node.height),
  )

  const availableZ = params.node.availableZ ?? []
  const primaryZ = availableZ.length > 0 ? Math.min(...availableZ) : 0

  let existingPointsInNode = 0
  let existingConnectionsTouchingNode = 0
  let totalConnections = 0
  let maxPointsPerConnectionInNode = 0
  let existingPointsOnPrimaryLayer = 0
  const existingLayersInNode = new Set<number>()

  if (params.connectionsWithResults) {
    totalConnections = params.connectionsWithResults.length

    for (const conn of params.connectionsWithResults) {
      const portPoints = conn.portPoints ?? []
      let touchesNode = false
      let pointsInThisConnectionInNode = 0

      for (const pp of portPoints) {
        if (isPointInNode(pp)) {
          existingPointsInNode += 1
          pointsInThisConnectionInNode += 1
          touchesNode = true
          existingLayersInNode.add(pp.z)
          if (pp.z === primaryZ) existingPointsOnPrimaryLayer += 1
        }
      }

      if (touchesNode) {
        existingConnectionsTouchingNode += 1
        if (pointsInThisConnectionInNode > maxPointsPerConnectionInNode) {
          maxPointsPerConnectionInNode = pointsInThisConnectionInNode
        }
      }
    }
  }

  let alreadyConnectedPointsInNode = 0
  let totalAlreadyConnectedPoints = 0
  let alreadyConnectedPointsOnPrimaryLayer = 0
  const alreadyConnectedLayersInNode = new Set<number>()

  if (params.alreadyConnectedPath) {
    totalAlreadyConnectedPoints = params.alreadyConnectedPath.length

    for (const pp of params.alreadyConnectedPath) {
      if (isPointInNode(pp)) {
        alreadyConnectedPointsInNode += 1
        alreadyConnectedLayersInNode.add(pp.z)
        if (pp.z === primaryZ) alreadyConnectedPointsOnPrimaryLayer += 1
      }
    }
  }

  const existing_connection_points_normalized_to_perimeter = Math.min(
    1,
    safeDiv(existingPointsInNode * params.traceWidth, nodePerimeter),
  )

  const already_connected_points_normalized_to_perimeter = Math.min(
    1,
    safeDiv(alreadyConnectedPointsInNode * params.traceWidth, nodePerimeter),
  )

  const fraction_of_existing_connections_touching_node = safeDiv(
    existingConnectionsTouchingNode,
    totalConnections,
  )

  const fraction_of_current_connection_already_in_node = safeDiv(
    alreadyConnectedPointsInNode,
    totalAlreadyConnectedPoints,
  )

  const existing_connection_points_normalized_to_area = Math.min(
    1,
    safeDiv(existingPointsInNode * params.traceWidth * minSide, area),
  )

  const already_connected_points_normalized_to_area = Math.min(
    1,
    safeDiv(alreadyConnectedPointsInNode * params.traceWidth * minSide, area),
  )

  const max_existing_connection_points_normalized_to_perimeter = Math.min(
    1,
    safeDiv(maxPointsPerConnectionInNode * params.traceWidth, nodePerimeter),
  )

  const already_connected_points_fraction_of_existing_points_in_node = safeDiv(
    alreadyConnectedPointsInNode,
    existingPointsInNode,
  )

  const existing_points_fraction_on_primary_layer = safeDiv(
    existingPointsOnPrimaryLayer,
    existingPointsInNode,
  )

  const already_connected_points_fraction_on_primary_layer = safeDiv(
    alreadyConnectedPointsOnPrimaryLayer,
    alreadyConnectedPointsInNode,
  )

  const existing_layers_fraction_used_in_node = safeDiv(
    existingLayersInNode.size,
    availableZ.length,
  )

  const already_connected_layers_fraction_used_in_node = safeDiv(
    alreadyConnectedLayersInNode.size,
    availableZ.length,
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
    total_crossings_normalized_to_area,
    total_crossings_normalized_to_trace_width,
    same_layer_crossings_fraction_of_total,
    entry_exit_layer_changes_fraction_of_total,
    transition_pair_crossings_fraction_of_total,
    width_normalized_to_max_side,
    height_normalized_to_max_side,
    trace_width_normalized_to_min_side,
    via_diameter_normalized_to_min_side,
    existing_connection_points_normalized_to_perimeter,
    already_connected_points_normalized_to_perimeter,
    fraction_of_existing_connections_touching_node,
    fraction_of_current_connection_already_in_node,
    existing_connection_points_normalized_to_area,
    already_connected_points_normalized_to_area,
    max_existing_connection_points_normalized_to_perimeter,
    already_connected_points_fraction_of_existing_points_in_node,
    existing_points_fraction_on_primary_layer,
    already_connected_points_fraction_on_primary_layer,
    existing_layers_fraction_used_in_node,
    already_connected_layers_fraction_used_in_node,
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
