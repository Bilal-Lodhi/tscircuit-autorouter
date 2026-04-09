import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

export type IssueCorrectionEvaluation = ReturnType<
  typeof evaluateIssueCorrectionRoutes
>
export type IssueCorrectionError =
  IssueCorrectionEvaluation["errorsWithCenters"][number]

export const evaluateIssueCorrectionRoutes = (
  srj: SimpleRouteJson,
  hdRoutes: HighDensityRoute[],
) => {
  const circuitJson = convertToCircuitJson(
    srj,
    hdRoutes,
    srj.minTraceWidth,
    srj.minViaDiameter,
  )
  const drcResult = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)
  return {
    circuitJson,
    ...drcResult,
  }
}

export const getIssueCenter = (error: IssueCorrectionError) =>
  "center" in error &&
  error.center &&
  typeof error.center === "object" &&
  typeof error.center.x === "number" &&
  typeof error.center.y === "number"
    ? { x: error.center.x, y: error.center.y }
    : null

export const getIssueKey = (error: IssueCorrectionError) => {
  const center = getIssueCenter(error)
  return [
    getIssueTraceId(error) ?? "",
    "pcb_placement_error_id" in error
      ? (error.pcb_placement_error_id ?? "")
      : "",
    center ? `${center.x.toFixed(3)},${center.y.toFixed(3)}` : "no-center",
    error.message ?? "",
  ].join("|")
}

export const getIssueTraceId = (error: IssueCorrectionError) =>
  "pcb_trace_id" in error ? error.pcb_trace_id : undefined

export const parseRouteIndexFromTraceId = (
  pcbTraceId: string | undefined,
): number | null => {
  if (!pcbTraceId) return null
  const match = pcbTraceId.match(/^trace_(\d+)(?:_\d+)?$/)
  return match ? Number.parseInt(match[1], 10) : null
}
