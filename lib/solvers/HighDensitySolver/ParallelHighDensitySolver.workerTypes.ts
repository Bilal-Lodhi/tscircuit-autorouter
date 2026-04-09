import type { SerializedConnectivityMap } from "./serializedConnectivityMap"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"

export type ParallelHighDensityWorkerTask = {
  taskId: number
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  serializedConnMap?: SerializedConnectivityMap
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}

export type ParallelHighDensityWorkerResult = {
  taskId: number
  ok: boolean
  solvedRoutes: HighDensityIntraNodeRoute[]
  iterations: number
  solverType: string
  supervisorType: string
  error?: string
}
