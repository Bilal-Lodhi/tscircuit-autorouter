import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"
import { NodeWithPortPointsLoader } from "./NodeWithPortPointsLoader"

export default function HighDensityDebuggerFixture() {
  return (
    <NodeWithPortPointsLoader
      title="High Density Debugger"
      description="Provide a NodeWithPortPoints JSON payload to explore it inside the HighDensityDebugger."
      renderDebugger={(node) => (
        <HighDensityDebugger nodeWithPortPoints={node} />
      )}
    />
  )
}
