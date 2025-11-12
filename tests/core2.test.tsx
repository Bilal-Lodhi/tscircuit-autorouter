import { RootCircuit, sel, createElement } from "@tscircuit/core"
import type { AnyCircuitElement } from "circuit-json"
import { test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { SimpleRouteJson } from "lib/types"

test("core2 - two traces", async () => {
  const circuit = new RootCircuit()

  circuit.add(
    createElement(
      "board" as any,
      {
        width: "10mm",
        height: "10mm",
        autorouter: {
          local: true,
          groupMode: "subcircuit",
          async algorithmFn(simpleRouteJson: SimpleRouteJson) {
            return new CapacityMeshAutorouterCoreBinding(simpleRouteJson)
          },
        },
      } as any,
      createElement("resistor" as any, {
        name: "R1",
        resistance: "1k",
        pcbX: -3,
        pcbY: 2,
        footprint: "0402",
      } as any),
      createElement("resistor" as any, {
        name: "R2",
        resistance: "1k",
        pcbX: -3,
        pcbY: -2,
        footprint: "0402",
      } as any),
      createElement("capacitor" as any, {
        name: "C1",
        capacitance: "1000pF",
        pcbX: 3,
        footprint: "0402",
      } as any),
      createElement("trace" as any, {
        from: sel.R1.pin1,
        to: sel.C1.pos,
      } as any),
      createElement("trace" as any, {
        from: sel.R2.pin1,
        to: sel.C1.pos,
      } as any),
    ),
  )

  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson() as AnyCircuitElement[]

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
