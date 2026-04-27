import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { arduinoUnoWithPowerGroundBottomInner2Pours } from "fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno-inner-pours.ts"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = arduinoUnoWithPowerGroundBottomInner2Pours as SimpleRouteJson

test("arduinoUnoWithPowerGroundBottomInner2Pours", () => {
  const solver = new AutoroutingPipelineSolver(srj, { effort: 2 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
