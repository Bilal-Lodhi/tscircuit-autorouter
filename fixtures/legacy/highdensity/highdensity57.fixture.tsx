import cn4075 from "fixtures/legacy/assets/cn4075-nodeWithPortPoints.json" with {
  type: "json",
}
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export const hyperParameters = {
  SEGMENTS_PER_POLYLINE: 6,
}

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn4075.nodeWithPortPoints} />
  )
}
