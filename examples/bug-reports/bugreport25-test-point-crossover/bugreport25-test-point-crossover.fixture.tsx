// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport25-test-point-crossover.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
