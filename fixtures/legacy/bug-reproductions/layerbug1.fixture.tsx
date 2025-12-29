import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import boardWithTopAndBottom from "fixtures/legacy/assets/boardwithtopandbottom.json" with {
  type: "json",
}

export default () => {
  return <AutoroutingPipelineDebugger srj={boardWithTopAndBottom as any} />
}
