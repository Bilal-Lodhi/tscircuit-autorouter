import { SUCCESS_FAILURE_RATIO_TARGET } from "./ml-data-collection-config"

const ML_DEBUG_VERBOSE = process.env.ML_DEBUG_VERBOSE === "1"

export type Outcome = "success" | "failure"

export type SuccessFailureStats = {
  success: number
  failure: number
}

const DEFAULT_TOLERANCE = 0.05
const DEFAULT_ATTEMPT_MULTIPLIER = 10

export const createInitialStats = (): SuccessFailureStats => ({
  success: 0,
  failure: 0,
})

export const getMaxAttempts = (maxSamples: number): number => {
  if (maxSamples <= 0) return 0
  return maxSamples * DEFAULT_ATTEMPT_MULTIPLIER
}

const getNextRatio = (stats: SuccessFailureStats, outcome: Outcome): number => {
  const nextSuccess = outcome === "success" ? stats.success + 1 : stats.success
  const nextTotal = stats.success + stats.failure + 1

  if (nextTotal <= 0) return 0

  return nextSuccess / nextTotal
}

const MIN_SAMPLES_FOR_STRICT_FILTER = 100

export const shouldAcceptSample = (
  stats: SuccessFailureStats,
  outcome: Outcome,
): boolean => {
  if (SUCCESS_FAILURE_RATIO_TARGET === "natural") {
    if (ML_DEBUG_VERBOSE) {
      console.log("ML_DEBUG_VERBOSE sampler: natural mode, always accept")
    }
    return true
  }

  const target = SUCCESS_FAILURE_RATIO_TARGET
  const total = stats.success + stats.failure

  if (ML_DEBUG_VERBOSE) {
    console.log(
      "ML_DEBUG_VERBOSE sampler before decision",
      "total",
      total,
      "success",
      stats.success,
      "failure",
      stats.failure,
      "outcome",
      outcome,
      "target",
      target,
    )
  }

  // Always accept the very first sample to bootstrap stats
  if (total === 0) {
    if (ML_DEBUG_VERBOSE) {
      console.log(
        "ML_DEBUG_VERBOSE sampler: accepting first sample unconditionally",
      )
    }
    return true
  }

  const nextRatio = getNextRatio(stats, outcome)

  const lower = Math.max(0, target - DEFAULT_TOLERANCE)
  const upper = Math.min(1, target + DEFAULT_TOLERANCE)

  if (ML_DEBUG_VERBOSE) {
    console.log(
      "ML_DEBUG_VERBOSE sampler ratio check",
      "nextRatio",
      nextRatio,
      "lower",
      lower,
      "upper",
      upper,
    )
  }

  // Once we have enough samples, enforce the strict band
  if (total >= MIN_SAMPLES_FOR_STRICT_FILTER) {
    const acceptStrict = nextRatio >= lower && nextRatio <= upper
    if (ML_DEBUG_VERBOSE) {
      console.log(
        "ML_DEBUG_VERBOSE sampler strict mode decision",
        "total",
        total,
        "accept",
        acceptStrict,
      )
    }
    return acceptStrict
  }

  // During bootstrapping, also accept samples that move
  // the overall ratio closer to the target even if
  // they are slightly outside the strict band.
  const currentRatio = stats.success / total
  const currentDelta = Math.abs(currentRatio - target)
  const nextDelta = Math.abs(nextRatio - target)

  if (ML_DEBUG_VERBOSE) {
    console.log(
      "ML_DEBUG_VERBOSE sampler bootstrap mode",
      "currentRatio",
      currentRatio,
      "currentDelta",
      currentDelta,
      "nextDelta",
      nextDelta,
    )
  }

  if (nextRatio >= lower && nextRatio <= upper) {
    if (ML_DEBUG_VERBOSE) {
      console.log("ML_DEBUG_VERBOSE sampler: accept (within band in bootstrap)")
    }
    return true
  }

  const acceptByDelta = nextDelta < currentDelta
  if (ML_DEBUG_VERBOSE) {
    console.log(
      "ML_DEBUG_VERBOSE sampler: decision based on delta",
      "accept",
      acceptByDelta,
    )
  }

  return acceptByDelta
}

export const updateStats = (
  stats: SuccessFailureStats,
  outcome: Outcome,
): SuccessFailureStats => {
  if (outcome === "success") {
    return {
      ...stats,
      success: stats.success + 1,
    }
  }

  return {
    ...stats,
    failure: stats.failure + 1,
  }
}
