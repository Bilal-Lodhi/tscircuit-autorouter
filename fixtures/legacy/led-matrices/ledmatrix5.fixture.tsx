import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import ledmatrix5 from "fixtures/legacy/assets/ledmatrix5_175.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={ledmatrix5 as unknown as SimpleRouteJson}
    />
  )
}
