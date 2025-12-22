import { CapacityMeshNode } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { Point } from "graphics-debug"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"

const settings = [
  { width: 1, height: 2.83, z: 1 },
  { width: 2.83, height: 1, z: 1 },
  { width: 81.574, height: 50.87, z: 1 },
  { width: 30.41, height: 68.33, z: 1 },
  { width: 10.86, height: 29.44, z: 1 },
  { width: 5.43, height: 16.31, z: 1 },
  { width: 0.839, height: 0.206, z: 1 },
  { width: 3.19, height: 1.59, z: 1 },
]

const connectionVariants = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const viaSizesVariants = [0.1, 0.2, 0.3, 0.4, 0.5]
const traceWidthsVariants = [0.05, 0.1, 0.15, 0.2, 0.25]

const FEATURE_SCHEMA = {
  top_edge_ports_normalized_to_width: { useForGeometric: true },
  right_edge_ports_normalized_to_height: { useForGeometric: true },
  bottom_edge_ports_normalized_to_width: { useForGeometric: true },
  left_edge_ports_normalized_to_height: { useForGeometric: true },
  same_layer_crossings_normalized_to_if_all_where_layercrossing: {
    useForGeometric: false,
  },
  layer_transitions_normalized_to_if_all_connections_where_transition: {
    useForGeometric: false,
  },
  single_via_area_normalized_to_area: { useForGeometric: true },
  two_via_area_normalized_to_area: { useForGeometric: true },
  board_aspect_ratio_not_normalized: { useForGeometric: true },
  total_trace_distance_normalized_to_diagonal: { useForGeometric: true },
  same_net_crossings_normalized_to_segments: { useForGeometric: false },
} as const

type FeatureKey = keyof typeof FEATURE_SCHEMA
type Features = Record<FeatureKey, number> & {
  did_hight_density_solver_find_solution?: boolean
}

type GeometricFeatureKey = {
  [K in FeatureKey]: (typeof FEATURE_SCHEMA)[K]["useForGeometric"] extends true
    ? K
    : never
}[FeatureKey]

const computeFeaturesForMl = (params: {
  portPoints: NodeWithPortPoints["portPoints"]
  node: CapacityMeshNode
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionPairCrossings: number
  viaSize: number
  traceWidth: number
}): Features => {
  const top = params.node.center.y + params.node.height / 2
  const bottom = params.node.center.y - params.node.height / 2
  const right = params.node.center.x + params.node.width / 2
  const left = params.node.center.x - params.node.width / 2

  const area = Math.max(1, params.node.width * params.node.height)
  const viaArea = Math.max(1, Math.PI * (params.viaSize / 2) ** 2)
  const diagonal = Math.sqrt(params.node.width ** 2 + params.node.height ** 2)

  let topPortCount = 0
  let bottomPortCount = 0
  let leftPortCount = 0
  let rightPortCount = 0
  let totalTraceDistance = 0

  for (const [index, portPoint] of params.portPoints.entries()) {
    if (portPoint.y - top === 0) topPortCount++
    else if (portPoint.y - bottom === 0) bottomPortCount++
    else if (portPoint.x - right === 0) rightPortCount++
    else if (portPoint.x - left === 0) leftPortCount++

    if (index > 0) {
      const last = params.portPoints[index - 1]
      totalTraceDistance += distance(
        { x: portPoint.x, y: portPoint.y },
        { x: last.x, y: last.y },
      )
    }
  }

  const setOfAlredySeenConnectionNames = new Set<string>()
  let countSameNetConnection = 0
  params.portPoints.some((e) => {
    if (setOfAlredySeenConnectionNames.has(e.connectionName)) {
      countSameNetConnection++
    } else {
      setOfAlredySeenConnectionNames.add(e.connectionName)
    }
  })

  const numNet = Math.max(1, params.portPoints.length)
  const uniqueNet = Math.max(1, setOfAlredySeenConnectionNames.size)

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
  const same_layer_crossings_normalized_to_if_all_where_layercrossing = safeDiv(
    params.numSameLayerCrossings,
    numNet,
  )
  const layer_transitions_normalized_to_if_all_connections_where_transition =
    safeDiv(params.numEntryExitLayerChanges, numNet)
  const single_via_occupancy_normalized_to_area = safeDiv(viaArea, area)
  const two_via_occupancy_normalized_to_area = safeDiv(viaArea * 2, area)
  const board_aspect_ratio_not_normalized = safeDiv(
    params.node.width,
    params.node.height,
  )
  const total_trace_distance_normalized_to_diagonal = safeDiv(
    totalTraceDistance,
    numNet * diagonal,
  )
  const same_net_crossings_normalized_to_segments = safeDiv(
    countSameNetConnection,
    uniqueNet,
  )

  return {
    top_edge_ports_normalized_to_width,
    right_edge_ports_normalized_to_height,
    bottom_edge_ports_normalized_to_width,
    left_edge_ports_normalized_to_height,
    same_layer_crossings_normalized_to_if_all_where_layercrossing,
    layer_transitions_normalized_to_if_all_connections_where_transition,
    single_via_area_normalized_to_area: single_via_occupancy_normalized_to_area,
    two_via_area_normalized_to_area: two_via_occupancy_normalized_to_area,
    board_aspect_ratio_not_normalized,
    total_trace_distance_normalized_to_diagonal,
    same_net_crossings_normalized_to_segments,
  }
}

const safeDiv = (a: number, b: number) => {
  if (b <= 0) return 0
  return a / b
}

const distance = (p1: Point, p2: Point) => {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)
}

type Candidate = {
  nodeWithPortPoints: NodeWithPortPoints
  node: CapacityMeshNode
  viaSize: number
  traceWidth: number
}

type GeometricFeatures = Pick<Features, GeometricFeatureKey>

const getGeometricFeatures = (candidate: Candidate): GeometricFeatures => {
  const { node, nodeWithPortPoints, viaSize } = candidate
  const top = node.center.y + node.height / 2
  const bottom = node.center.y - node.height / 2
  const right = node.center.x + node.width / 2
  const left = node.center.x - node.width / 2

  const area = Math.max(1, node.width * node.height)
  const viaArea = Math.max(1, Math.PI * (viaSize / 2) ** 2)
  const diagonal = Math.sqrt(node.width ** 2 + node.height ** 2)

  let topPortCount = 0
  let bottomPortCount = 0
  let leftPortCount = 0
  let rightPortCount = 0
  let totalTraceDistance = 0

  for (const [index, portPoint] of nodeWithPortPoints.portPoints.entries()) {
    if (Math.abs(portPoint.y - top) < 0.0001) topPortCount++
    else if (Math.abs(portPoint.y - bottom) < 0.0001) bottomPortCount++
    else if (Math.abs(portPoint.x - right) < 0.0001) rightPortCount++
    else if (Math.abs(portPoint.x - left) < 0.0001) leftPortCount++

    if (index > 0) {
      const last = nodeWithPortPoints.portPoints[index - 1]
      totalTraceDistance += distance(
        { x: portPoint.x, y: portPoint.y },
        { x: last.x, y: last.y },
      )
    }
  }

  const numNet = Math.max(1, nodeWithPortPoints.portPoints.length)

  return {
    top_edge_ports_normalized_to_width: safeDiv(topPortCount, node.width),
    right_edge_ports_normalized_to_height: safeDiv(rightPortCount, node.height),
    bottom_edge_ports_normalized_to_width: safeDiv(bottomPortCount, node.width),
    left_edge_ports_normalized_to_height: safeDiv(leftPortCount, node.height),
    single_via_area_normalized_to_area: safeDiv(viaArea, area),
    two_via_area_normalized_to_area: safeDiv(viaArea * 2, area),
    board_aspect_ratio_not_normalized: safeDiv(node.width, node.height),
    total_trace_distance_normalized_to_diagonal: safeDiv(
      totalTraceDistance,
      numNet * diagonal,
    ),
  }
}

const featuresToVector = (features: GeometricFeatures): number[] => {
  return [
    features.top_edge_ports_normalized_to_width,
    features.right_edge_ports_normalized_to_height,
    features.bottom_edge_ports_normalized_to_width,
    features.left_edge_ports_normalized_to_height,
    features.single_via_area_normalized_to_area,
    features.two_via_area_normalized_to_area,
    features.board_aspect_ratio_not_normalized,
    features.total_trace_distance_normalized_to_diagonal,
  ]
}

const euclideanDistance = (vec1: number[], vec2: number[]): number => {
  let sum = 0
  for (let i = 0; i < vec1.length; i++) {
    const diff = vec1[i] - vec2[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

const getMinDistanceToSet = (
  geoFeatures: GeometricFeatures,
  processedSet: number[][],
): number => {
  if (processedSet.length === 0) return Infinity
  const vec = featuresToVector(geoFeatures)
  let minDist = Infinity
  for (const processedVec of processedSet) {
    const dist = euclideanDistance(vec, processedVec)
    if (dist < minDist) {
      minDist = dist
    }
  }
  return minDist
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

      switch (edge) {
        case "top":
          y = node.center.y + halfH
          x = node.center.x + (Math.random() - 0.5) * node.width
          break
        case "bottom":
          y = node.center.y - halfH
          x = node.center.x + (Math.random() - 0.5) * node.width
          break
        case "left":
          x = node.center.x - halfW
          y = node.center.y + (Math.random() - 0.5) * node.height
          break
        case "right":
          x = node.center.x + halfW
          y = node.center.y + (Math.random() - 0.5) * node.height
          break
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

const generateDiverseCandidates = (count: number): Candidate[] => {
  const candidates: Candidate[] = []

  for (let i = 0; i < count; i++) {
    const setting = settings[Math.floor(Math.random() * settings.length)]
    const numConnections =
      connectionVariants[Math.floor(Math.random() * connectionVariants.length)]
    const viaSize =
      viaSizesVariants[Math.floor(Math.random() * viaSizesVariants.length)]
    const traceWidth =
      traceWidthsVariants[
        Math.floor(Math.random() * traceWidthsVariants.length)
      ]

    const node: CapacityMeshNode = {
      capacityMeshNodeId: `node_${i}`,
      center: { x: 0, y: 0 },
      width: setting.width,
      height: setting.height,
      layer: "top",
      availableZ: [0, 1],
    }

    const portPoints = generateRandomPortPoints(numConnections, node, [0, 1])

    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      portPoints,
      availableZ: [0, 1],
    }

    candidates.push({
      nodeWithPortPoints,
      node,
      viaSize,
      traceWidth,
    })
  }

  return candidates
}

const isInformationSaturationReached = (
  dataset: Array<Features & { cost: number }>,
): boolean => {
  if (dataset.length < 100) return false

  const last50 = dataset.slice(-50)
  const costs = last50.map((d) => d.cost)
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length
  const variance =
    costs.reduce((sum, val) => sum + (val - mean) ** 2, 0) / costs.length
  const stdDev = Math.sqrt(variance)

  return stdDev < 0.01
}

const saveDatasetToJson = async (
  dataset: Array<Features & { cost: number }>,
  filename: string,
) => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const outputPath = path.join(process.cwd(), filename)
  const jsonContent = JSON.stringify(dataset, null, 2)

  await fs.writeFile(outputPath, jsonContent, "utf-8")
}

async function run() {
  const MAX_COMPUTE = 5000
  const SAMPLE_SIZE = 100
  const BATCH_SIZE = 50
  const OUTPUT_FILE = "ml-training-data.json"

  const dataset: Array<Features & { cost: number }> = []
  const processedGeometricFeatures: number[][] = []

  console.log(`Starting ML data generation with MAX_COMPUTE=${MAX_COMPUTE}`)
  console.log(`Memory limit check enabled, batch size: ${BATCH_SIZE}`)

  let iterationCount = 0
  let solvedCount = 0
  let failedCount = 0
  const TARGET_PER_CLASS = MAX_COMPUTE / 2

  while (dataset.length < MAX_COMPUTE) {
    iterationCount++

    if (processedGeometricFeatures.length > 10000) {
      console.log("Memory limit: Trimming processed features to last 5000")
      processedGeometricFeatures.splice(
        0,
        processedGeometricFeatures.length - 5000,
      )
    }

    const candidates = generateDiverseCandidates(SAMPLE_SIZE)

    let bestCandidate: Candidate | null = null
    let bestDist = -1
    let bestGeo: GeometricFeatures | null = null

    for (const candidate of candidates) {
      const geo = getGeometricFeatures(candidate)
      const minDist = getMinDistanceToSet(geo, processedGeometricFeatures)

      if (minDist > bestDist) {
        bestDist = minDist
        bestCandidate = candidate
        bestGeo = geo
      }
    }

    if (!bestCandidate || !bestGeo) {
      console.log("No suitable candidate found, breaking")
      break
    }

    const { nodeWithPortPoints, node, viaSize, traceWidth } = bestCandidate

    const {
      numSameLayerCrossings,
      numEntryExitLayerChanges,
      numTransitionPairCrossings,
    } = getIntraNodeCrossings(nodeWithPortPoints)

    const finalFeatures = computeFeaturesForMl({
      portPoints: nodeWithPortPoints.portPoints,
      node,
      numSameLayerCrossings,
      numEntryExitLayerChanges,
      numTransitionPairCrossings,
      viaSize,
      traceWidth: traceWidth,
    })

    const cost =
      numSameLayerCrossings +
      numEntryExitLayerChanges +
      numTransitionPairCrossings

    const hdSolver = new HighDensitySolver({
      nodePortPoints: [nodeWithPortPoints],
      viaDiameter: viaSize,
      traceWidth: traceWidth,
    })

    hdSolver.solve()

    if (hdSolver.solved && solvedCount < TARGET_PER_CLASS) {
      solvedCount++
      dataset.push({
        ...finalFeatures,
        cost,
        did_hight_density_solver_find_solution: hdSolver.solved,
      })
      processedGeometricFeatures.push(featuresToVector(bestGeo))
    } else if (hdSolver.solved && failedCount < TARGET_PER_CLASS) {
      failedCount++
      dataset.push({
        ...finalFeatures,
        cost,
        did_hight_density_solver_find_solution: hdSolver.solved,
      })
      processedGeometricFeatures.push(featuresToVector(bestGeo))
    }

    if (dataset.length % 10 === 0) {
      console.log(
        `Progress: ${dataset.length}/${MAX_COMPUTE} samples collected (diversity: ${bestDist.toFixed(4)})`,
      )
    }

    if (dataset.length % BATCH_SIZE === 0) {
      console.log(`Saving batch to ${OUTPUT_FILE}...`)
      await saveDatasetToJson(dataset, OUTPUT_FILE)
      console.log(`Saved ${dataset.length} samples`)
    }

    if (isInformationSaturationReached(dataset)) {
      console.log(`Information saturation reached at ${dataset.length} samples`)
      break
    }
  }

  console.log(`Data generation complete. Total samples: ${dataset.length}`)
  console.log("Final save...")
  await saveDatasetToJson(dataset, OUTPUT_FILE)
  console.log(`All data saved to ${OUTPUT_FILE}`)
  console.log("Sample data:", dataset.slice(0, 3))

  return dataset
}

run()
