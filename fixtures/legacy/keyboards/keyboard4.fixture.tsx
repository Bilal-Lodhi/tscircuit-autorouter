import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import keyboard4 from "fixtures/legacy/assets/keyboard4.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={keyboard4 as unknown as SimpleRouteJson}
    />
  )
}
