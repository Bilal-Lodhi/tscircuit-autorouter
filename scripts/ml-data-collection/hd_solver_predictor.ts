export interface HighDensitySolverParams {
  totalCrossingsNormalizedToArea: number
  entryExitLayerChangesNormalizedToArea: number
  twoViaAreaNormalizedToArea: number
  singleViaAreaNormalizedToArea: number
  transitionPairCrossingsNormalizedToArea: number
  cost: number
  viaDiameterNormalizedToMinSide: number
  transitionPairCrossingsFractionOfTotal: number
  traceWidthNormalizedToMinSide: number
  entryExitLayerChangesFractionOfTotal: number
  entryExitLayerChangesNormalizedToTraceWidth: number
  transitionPairCrossingsNormalizedToTraceWidth: number
}

export function predictHighDensitySolverSuccess(
  params: HighDensitySolverParams,
): number {
  const features = [
    params.totalCrossingsNormalizedToArea,
    params.entryExitLayerChangesNormalizedToArea,
    params.twoViaAreaNormalizedToArea,
    params.singleViaAreaNormalizedToArea,
    params.transitionPairCrossingsNormalizedToArea,
    params.cost,
    params.viaDiameterNormalizedToMinSide,
    params.transitionPairCrossingsFractionOfTotal,
    params.traceWidthNormalizedToMinSide,
    params.entryExitLayerChangesFractionOfTotal,
    params.entryExitLayerChangesNormalizedToTraceWidth,
    params.transitionPairCrossingsNormalizedToTraceWidth,
  ]

  const means = [
    0.531721, 1.451517, 0.613585, 0.306793, 1.281412, 8.73774, 0.177836,
    0.307598, 0.081489, 0.647887, 43.312722, 36.109453,
  ]

  const stds = [
    0.468585, 2.110459, 0.731386, 0.365693, 2.638042, 6.534922, 0.171687,
    0.218637, 0.079793, 0.229034, 38.218288, 50.459705,
  ]

  const weights = [
    -1.297282, -1.62736, -0.175368, -0.175368, 0.540047, -1.639603, -0.009767,
    0.46838, 0.320372, 0.894686, -0.765384, 1.300592,
  ]

  const bias = -0.222911
  const temperature = 0.05

  const normalized = features.map((f, i) => (f - means[i]) / stds[i])
  const z = normalized.reduce((sum, x, i) => sum + x * weights[i], bias)
  const baseProb = 1 / (1 + Math.exp(-z))
  const logit = Math.log(baseProb / (1 - baseProb + 1e-10))
  const scaledLogit = logit / temperature
  const extremeProb = 1 / (1 + Math.exp(-scaledLogit))

  return extremeProb
}

export function willHighDensitySolverSucceed(
  params: HighDensitySolverParams,
): boolean {
  return predictHighDensitySolverSuccess(params) > 0.5
}
