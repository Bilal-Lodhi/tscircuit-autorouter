// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import inputJson from "./escapeViaLocationSolver_input.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={inputJson[0]} />
}
