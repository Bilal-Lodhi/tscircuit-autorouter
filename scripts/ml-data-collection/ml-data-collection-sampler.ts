import { SUCCESS_FAILURE_RATIO_TARGET } from "./ml-data-collection-config"

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
    return true
  }

  const target = SUCCESS_FAILURE_RATIO_TARGET
  const total = stats.success + stats.failure

  // Always accept the very first sample to bootstrap stats
  if (total === 0) {
    return true
  }

  const nextRatio = getNextRatio(stats, outcome)

  const lower = Math.max(0, target - DEFAULT_TOLERANCE)
  const upper = Math.min(1, target + DEFAULT_TOLERANCE)

  // Once we have enough samples, enforce the strict band
  if (total >= MIN_SAMPLES_FOR_STRICT_FILTER) {
    return nextRatio >= lower && nextRatio <= upper
  }

  // During bootstrapping, also accept samples that move
  // the overall ratio closer to the target even if
  // they are slightly outside the strict band.
  const currentRatio = stats.success / total
  const currentDelta = Math.abs(currentRatio - target)
  const nextDelta = Math.abs(nextRatio - target)

  if (nextRatio >= lower && nextRatio <= upper) {
    return true
  }

  return nextDelta < currentDelta
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
