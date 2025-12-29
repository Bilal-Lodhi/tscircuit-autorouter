import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import ledmatrix6 from "fixtures/legacy/assets/ledmatrix6_371.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={ledmatrix6 as unknown as SimpleRouteJson}
    />
  )
}
