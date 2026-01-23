import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Jumper as SrjJumper, JumperType } from "../../types/srj-types"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import {
  JumperPrepatternSolver2_HyperGraph,
  type JumperPrepatternSolver2Params,
  JumperPrepatternSolver2HyperParameters,
} from "./JumperPrepatternSolver2_HyperGraph"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export interface HyperJumperPrepatternSolver2Params {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  connMap?: ConnectivityMap
  hyperParameters?: JumperPrepatternSolver2HyperParameters
  /** Available jumper types. Defaults to ["0603"] */
  availableJumperTypes?: JumperType[]
}

type VariantHyperParameters = {
  COLS: number
  ROWS: number
  ORIENTATION: "horizontal" | "vertical"
  JUMPER_TYPE: JumperType
}

/**
 * HyperJumperPrepatternSolver2 runs multiple variants of JumperPrepatternSolver2_HyperGraph
 * with different pattern types and orientations, then picks the best solution.
 *
 * Variants:
 * - single_1206x4_vertical
 * - single_1206x4_horizontal
 * - 2x2_1206x4_vertical (only if node is large enough, ~14x14mm)
 * - 2x2_1206x4_horizontal (only if node is large enough, ~14x14mm)
 */
export class HyperJumperPrepatternSolver2 extends HyperParameterSupervisorSolver<JumperPrepatternSolver2_HyperGraph> {
  constructorParams: HyperJumperPrepatternSolver2Params
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  connMap?: ConnectivityMap
  baseHyperParameters?: JumperPrepatternSolver2HyperParameters
  availableJumperTypes: JumperType[]

  // Output
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []
  // All jumpers from the winning solver (SRJ format with connectedTo populated)
  jumpers: SrjJumper[] = []

  constructor(params: HyperJumperPrepatternSolver2Params) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.connMap = params.connMap
    this.baseHyperParameters = params.hyperParameters ?? {}
    this.availableJumperTypes = params.availableJumperTypes ?? ["0603"]
    this.MAX_ITERATIONS = 1e6
    this.GREEDY_MULTIPLIER = 1
    this.MIN_SUBSTEPS = 1000
  }

  getConstructorParams(): HyperJumperPrepatternSolver2Params {
    return this.constructorParams
  }

  getHyperParameterDefs() {
    const defs: Array<{
      name: string
      possibleValues: Array<Record<string, any>>
    }> = []

    // Add jumper type options based on available types
    const jumperTypeValues = this.availableJumperTypes.map((type) => ({
      JUMPER_TYPE: type,
    }))
    defs.push({
      name: "jumperType",
      possibleValues: jumperTypeValues,
    })

    // For 0603: valid values are 1, 2, 4, 6, 8 (skip 3, 5, 7)
    // For 1206x4: use existing values
    // We'll include all possible values and filter invalid combos in getCombinationDefs
    const colValues0603 = [1, 2, 3, 4, 6, 8, 10]
    const rowValues0603 = [1, 2, 3, 4, 6, 8, 10]
    const colValues1206x4 = [1, 2, 3, 4, 6, 8, 10]
    const rowValues1206x4 = [1, 2, 3, 4, 8]

    // Collect all unique col/row values
    const allCols = [...new Set([...colValues0603, ...colValues1206x4])].sort(
      (a, b) => a - b,
    )
    const allRows = [...new Set([...rowValues0603, ...rowValues1206x4])].sort(
      (a, b) => a - b,
    )

    defs.push({
      name: "cols",
      possibleValues: allCols.map((c) => ({ COLS: c })),
    })

    defs.push({
      name: "rows",
      possibleValues: allRows.map((r) => ({ ROWS: r })),
    })

    defs.push({
      name: "orientation",
      possibleValues: [
        { ORIENTATION: "vertical" as const },
        { ORIENTATION: "horizontal" as const },
      ],
    })

    return defs
  }

  /**
   * Filter out invalid row/col combinations for each jumper type.
   * For 0603: only allow 1, 2, 4, 6, 8 for both rows and cols
   * For 1206x4: allow existing values (1, 2, 3, 4, 6, 8, 10 for cols; 1, 2, 3, 4, 8 for rows)
   */
  isValidCombination(hyperParameters: VariantHyperParameters): boolean {
    const { JUMPER_TYPE, COLS, ROWS } = hyperParameters
    const valid0603Values = [1, 2, 4, 6, 8]
    const validCols1206x4 = [1, 2, 3, 4, 6, 8, 10]
    const validRows1206x4 = [1, 2, 3, 4, 8]

    if (JUMPER_TYPE === "0603") {
      return valid0603Values.includes(COLS) && valid0603Values.includes(ROWS)
    } else if (JUMPER_TYPE === "1206x4") {
      return validCols1206x4.includes(COLS) && validRows1206x4.includes(ROWS)
    }
    return false
  }

  getCombinationDefs() {
    // Try all combinations of jumperType, cols, rows, and orientation
    return [["jumperType", "cols", "rows", "orientation"]]
  }

  /**
   * Override initializeSolvers to filter out invalid combinations before creating solvers.
   */
  initializeSolvers() {
    const hyperParameterDefs = this.getHyperParameterDefs()

    const combinationDefs = this.getCombinationDefs() ?? [
      hyperParameterDefs.map((def) => def.name),
    ]

    this.supervisedSolvers = []
    for (const combinationDef of combinationDefs) {
      const hyperParameterCombinations = this.getHyperParameterCombinations(
        hyperParameterDefs.filter((hpd) => combinationDef.includes(hpd.name)),
      )

      for (const hyperParameters of hyperParameterCombinations) {
        // Filter out invalid combinations
        if (!this.isValidCombination(hyperParameters as VariantHyperParameters))
          continue

        const solver = this.generateSolver(
          hyperParameters as VariantHyperParameters,
        )
        const g = this.computeG(solver)
        this.supervisedSolvers.push({
          hyperParameters,
          solver,
          h: 0,
          g,
          f: g,
        })
      }
    }
  }

  generateSolver(
    hyperParameters: VariantHyperParameters,
  ): JumperPrepatternSolver2_HyperGraph {
    return new JumperPrepatternSolver2_HyperGraph({
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      traceWidth: this.traceWidth,
      hyperParameters: {
        COLS: hyperParameters.COLS,
        ROWS: hyperParameters.ROWS,
        ORIENTATION: hyperParameters.ORIENTATION,
        JUMPER_TYPE: hyperParameters.JUMPER_TYPE,
      },
    })
  }

  computeG(solver: JumperPrepatternSolver2_HyperGraph): number {
    const jumperCount =
      solver.hyperParameters.COLS! * solver.hyperParameters.ROWS!
    // Prefer solutions with fewer iterations, or fewer jumpers
    return solver.iterations / 10000 + jumperCount * 0.25
  }

  computeH(solver: JumperPrepatternSolver2_HyperGraph): number {
    // Estimate remaining work based on progress
    return 1 - (solver.progress || 0)
  }

  onSolve(solver: SupervisedSolver<JumperPrepatternSolver2_HyperGraph>) {
    this.solvedRoutes = solver.solver.solvedRoutes
    this.jumpers = solver.solver.getOutputJumpers()
  }

  getOutput(): HighDensityIntraNodeRouteWithJumpers[] {
    return this.solvedRoutes
  }

  getOutputJumpers(): SrjJumper[] {
    return this.jumpers
  }

  visualize(): GraphicsObject {
    if (this.winningSolver) {
      return this.winningSolver.visualize()
    }
    return super.visualize()
  }
}
