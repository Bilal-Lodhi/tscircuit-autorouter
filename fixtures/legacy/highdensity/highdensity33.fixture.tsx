import cn61595 from "fixtures/legacy/assets/cn61595-nodeWithPortPoints.json" with {
  type: "json",
}
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

export const hyperParameters = {
  CELL_SIZE_FACTOR: 2,
  VIA_PENALTY_FACTOR_2: 10,
}

export default () => {
  return (
    // <HyperHighDensityDebugger nodeWithPortPoints={cn61595.nodeWithPortPoints} />
    <GenericSolverDebugger
      createSolver={() =>
        new IntraNodeRouteSolver({
          nodeWithPortPoints: cn61595.nodeWithPortPoints,
          colorMap: generateColorMapFromNodeWithPortPoints(
            cn61595.nodeWithPortPoints,
          ),
          hyperParameters,
        })
      }
    />
  )
}
