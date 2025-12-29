import cn1852 from "fixtures/legacy/assets/cn1852-nodeWithPortPoints.json" with {
  type: "json",
}
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn1852.nodeWithPortPoints} />
  )
}
