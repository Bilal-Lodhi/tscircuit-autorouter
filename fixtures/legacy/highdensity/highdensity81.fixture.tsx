import cn541 from "fixtures/legacy/assets/cn541-nodeWithPortPoints.json" assert { type: "json" }
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn541.nodeWithPortPoints} />
  )
}
