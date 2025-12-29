import cn1069 from "fixtures/legacy/assets/cn1069-nodeWithPortPoints.json" with {
  type: "json",
}
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn1069.nodeWithPortPoints} />
  )
}
