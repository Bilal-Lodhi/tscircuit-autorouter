import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import ledLetterS from "fixtures/legacy/assets/led-letter-s.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={ledLetterS as unknown as SimpleRouteJson}
    />
  )
}
