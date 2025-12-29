import cn19735 from "fixtures/legacy/assets/cn19735-nodeWithPortPoints.json" assert { type: "json" }
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn19735.nodeWithPortPoints} />
  )
}
