import { test, expect } from "bun:test"
import { getSimpleRouteJsonFromCircuitJson, RootCircuit } from "@tscircuit/core"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver4 } from "lib/index"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsVertically } from "stack-svgs"

test("pipeline1 bug1", () => {
  const circuit = new RootCircuit()

  circuit.add(
    <board routingDisabled>
      <chip
        name="45-degree-obs"
        pcbRotation={45}
        pinLabels={{ pin1: "OBSTACLE" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              shape="rect"
              width={3.9}
              height={0.9}
            />
          </footprint>
        }
      />
    </board>,
  )

  circuit.renderUntilSettled()

  const circuit_json = circuit.getCircuitJson()

  const pcbSvg = convertCircuitJsonToPcbSvg(circuit_json as any)
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    db: circuit.db,
  })

  const startSolver = new AutoroutingPipelineSolver4(simpleRouteJson as any, {
    cacheProvider: null,
  })

  const pipelineSvg = getSvgFromGraphicsObject(startSolver.visualize(), {
    includeTextLabels: true,
  })

  const combined = stackSvgsVertically([pcbSvg, pipelineSvg], {
    normalizeSize: false,
    gap: 0,
  })

  expect(combined).toMatchSvgSnapshot(import.meta.path)
})
