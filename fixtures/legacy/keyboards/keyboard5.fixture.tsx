import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import keyboard5 from "fixtures/legacy/assets/keyboard5.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={keyboard5 as unknown as SimpleRouteJson}
    />
  )
}
