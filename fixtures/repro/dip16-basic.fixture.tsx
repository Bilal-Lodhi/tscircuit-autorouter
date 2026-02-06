// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import reproJson from "../../tests/repro/dip16-basic.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={reproJson} />
}
