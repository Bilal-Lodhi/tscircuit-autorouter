export interface CapacityHyperParameters {
  VIA_DIAMETER: number
  TRACE_WIDTH: number

  MAX_CAPACITY_FACTOR: number
  /** Penalty cost for adding a via (layer transition at non-MLCP node) during A* pathfinding */
  viaPenalty: number
}
