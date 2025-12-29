import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import keyboard3 from "fixtures/legacy/assets/keyboard3.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={keyboard3 as unknown as SimpleRouteJson}
      animationSpeed={10}
    />
  )
}
