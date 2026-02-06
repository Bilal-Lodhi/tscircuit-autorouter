import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import e2e3 from "fixtures/legacy/assets/e2e3.json" with { type: "json" }

const srj: SimpleRouteJson = {
  ...(e2e3 as SimpleRouteJson),
  layerCount: 1,
  availableJumperTypes: ["0603"],
}

export default () => <AutoroutingPipelineDebugger srj={srj} />
