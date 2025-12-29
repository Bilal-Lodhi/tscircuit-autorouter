import cn1317 from "fixtures/legacy/assets/cn1317-nodeWithPortPoints.json" assert { type: "json" }
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn1317.nodeWithPortPoints} />
  )
}
