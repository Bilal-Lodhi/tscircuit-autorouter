import { getSimpleRouteJsonFromCircuitJson, RootCircuit } from "@tscircuit/core"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"

const circuit = new RootCircuit()

circuit.add(
  <board routingDisabled>
    <chip
      name="45-degree-obs"
      pcbRotation={45}
      pinLabels={{ pin1: "OBSTACLE" }}
      footprint={
        <footprint>
          <smtpad portHints={["pin1"]} shape="rect" width={3.9} height={0.9} />
        </footprint>
      }
    />
  </board>,
)

circuit.renderUntilSettled()

const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
  db: circuit.db,
})

export default () => {
  return <AutoroutingPipelineDebugger srj={simpleRouteJson as any} />
}
