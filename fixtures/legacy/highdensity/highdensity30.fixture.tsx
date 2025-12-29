import cn11104 from "fixtures/legacy/assets/cn11104-nodeWithPortPoints.json" assert { type: "json" }
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn11104.nodeWithPortPoints} />
  )
}
