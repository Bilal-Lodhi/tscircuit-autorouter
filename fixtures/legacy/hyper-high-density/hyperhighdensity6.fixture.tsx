import cn16428 from "fixtures/legacy/assets/cn16428-nodeWithPortPoints.json" assert { type: "json" }
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn16428.nodeWithPortPoints} />
  )
}
