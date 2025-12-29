import repro1 from "fixtures/legacy/assets/repro1.json" with { type: "json" }
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"

export default () => <AutoroutingPipelineDebugger srj={repro1 as any} />
