import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "./four-obstacles.srj.json"

export default () => (
  <AutoroutingPipelineDebugger srj={simpleRouteJson as SimpleRouteJson} />
)
