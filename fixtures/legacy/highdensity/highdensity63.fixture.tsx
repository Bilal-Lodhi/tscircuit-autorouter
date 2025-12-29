import cn2432 from "fixtures/legacy/assets/cn2432-nodeWithPortPoints.json" assert { type: "json" }
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export const hyperParameters = {
  SEGMENTS_PER_POLYLINE: 6,
}

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn2432.nodeWithPortPoints} />
  )
}
