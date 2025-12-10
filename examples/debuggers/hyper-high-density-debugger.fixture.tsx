import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import { NodeWithPortPointsLoader } from "./NodeWithPortPointsLoader"

export default function HyperHighDensityDebuggerFixture() {
  return (
    <NodeWithPortPointsLoader
      title="Hyper High Density Debugger"
      description="Paste a NodeWithPortPoints JSON payload or open this fixture with the nodeWithPortPoints query parameter to inspect it in the HyperHighDensityDebugger."
      renderDebugger={(node) => (
        <HyperHighDensityDebugger nodeWithPortPoints={node} />
      )}
    />
  )
}
