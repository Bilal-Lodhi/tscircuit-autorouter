import cn7890 from "fixtures/legacy/assets/cn7890-nodeWithPortPoints.json" with {
  type: "json",
}
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn7890.nodeWithPortPoints} />
  )
}
