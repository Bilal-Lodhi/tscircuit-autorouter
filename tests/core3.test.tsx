import { RootCircuit, sel, createElement } from "@tscircuit/core"
import type { AnyCircuitElement } from "circuit-json"
import { test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { SimpleRouteJson } from "lib/types"

test("core3 - 0402 columns", async () => {
  const circuit = new RootCircuit()

  circuit.add(
    createElement(
      "board" as any,
      {
        width: "10mm",
        height: "100mm",
        autorouter: {
          local: true,
          groupMode: "subcircuit",
        },
      } as any,
      ...Array.from({ length: 30 }).flatMap((_, i) => [
        createElement("capacitor" as any, {
          key: `C${i}`,
          name: `C${i}`,
          capacitance: "1000pF",
          footprint: "0402",
          schX: -3,
          pcbX: -3,
          pcbY: (i / 30 - 0.5) * 60,
        } as any),
        createElement("resistor" as any, {
          key: `R${i}`,
          name: `R${i}`,
          resistance: "1k",
          footprint: "0402",
          schX: 3,
          pcbX: 3,
          pcbY: (i / 30 - 0.5) * 60,
        } as any),
        createElement("trace" as any, {
          key: `T${i}`,
          from: `.R${i} > .pin1`,
          to: `.C${i} > .pin1`,
        } as any),
      ]),
    ),
  )

  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson() as AnyCircuitElement[]

  expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
  )
}, { timeout: 60_000 })
