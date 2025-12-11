import { AssignableViaAutoroutingPipelineSolver } from "lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaAutoroutingPipelineSolver"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import type { FormEvent } from "react"
import { useMemo, useState } from "react"

const defaultJson = {
  bounds: {
    minX: -10,
    maxX: 10,
    minY: -4,
    maxY: 4,
  },
  obstacles: [
    {
      type: "oval",
      layers: ["top"],
      center: {
        x: -7,
        y: 0,
      },
      width: 1.2,
      height: 1.2,
      connectedTo: [
        "pcb_smtpad_0",
        "connectivity_net0",
        "source_trace_0",
        "source_port_0",
        "source_port_3",
        "pcb_smtpad_0",
        "pcb_port_0",
        "pcb_smtpad_3",
        "pcb_port_3",
      ],
      zLayers: [0],
    },
    {
      type: "rect",
      layers: ["top"],
      center: {
        x: -0.825,
        y: 0,
      },
      width: 0.8,
      height: 0.95,
      connectedTo: [
        "pcb_smtpad_1",
        "connectivity_net11",
        "source_port_1",
        "pcb_smtpad_1",
        "pcb_port_1",
      ],
      zLayers: [0],
    },
    {
      type: "rect",
      layers: ["top"],
      center: {
        x: 0.825,
        y: 0,
      },
      width: 0.8,
      height: 0.95,
      connectedTo: [
        "pcb_smtpad_2",
        "connectivity_net12",
        "source_port_2",
        "pcb_smtpad_2",
        "pcb_port_2",
      ],
      zLayers: [0],
    },
    {
      type: "oval",
      layers: ["top"],
      center: {
        x: 7,
        y: 0,
      },
      width: 1.2,
      height: 1.2,
      connectedTo: [
        "pcb_smtpad_3",
        "connectivity_net0",
        "source_trace_0",
        "source_port_0",
        "source_port_3",
        "pcb_smtpad_0",
        "pcb_port_0",
        "pcb_smtpad_3",
        "pcb_port_3",
      ],
      zLayers: [0],
    },
    {
      type: "rect",
      layers: ["top", "inner1", "inner2", "bottom"],
      center: {
        x: 0,
        y: 0,
      },
      width: 0.25,
      height: 8,
      connectedTo: [],
      zLayers: [0, 1],
    },
  ],
  connections: [
    {
      name: "source_trace_0",
      source_trace_id: "source_trace_0",
      pointsToConnect: [
        {
          x: -7,
          y: 0,
          layer: "top",
          pointId: "pcb_port_0",
          pcb_port_id: "pcb_port_0",
        },
        {
          x: 7,
          y: 0,
          layer: "top",
          pointId: "pcb_port_3",
          pcb_port_id: "pcb_port_3",
        },
      ],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.15,
} as const

const defaultJsonString = JSON.stringify(defaultJson, null, 2)

const UnassignedViaAutoroutingPipelineDebugger = ({
  srj,
}: {
  srj: SimpleRouteJson
}) => (
  <AutoroutingPipelineDebugger
    createSolver={(simpleRouteJson, opts) =>
      new AssignableViaAutoroutingPipelineSolver(simpleRouteJson, opts)
    }
    srj={srj}
  />
)

export default function UnassignedViaWelcomeFixture() {
  const [inputValue, setInputValue] = useState(defaultJsonString)
  const [srj, setSrj] = useState<SimpleRouteJson>(
    () => defaultJson as unknown as SimpleRouteJson,
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const parsed = JSON.parse(inputValue) as SimpleRouteJson
      setSrj(parsed)
    } catch (error) {
      alert("Invalid JSON! Please enter valid Simple Route Json.")
      console.error("JSON parse error:", error)
    }
  }

  const handleReset = () => {
    setInputValue(defaultJsonString)
    setSrj(defaultJson as unknown as SimpleRouteJson)
  }

  const helperText = useMemo(
    () =>
      "Paste or tweak the unassigned via routing scenario and load it directly into the debugger.",
    [],
  )

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">
          Unassigned Via Autorouting Pipeline Debugger
        </h1>
        <p className="text-gray-700">{helperText}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm font-semibold">
          Simple Route Json
          <textarea
            className="w-full h-80 mt-2 p-3 border border-gray-300 rounded-lg font-mono text-sm"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
        </label>
        <div className="flex gap-3">
          <button
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Load JSON
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="bg-gray-200 text-gray-900 px-4 py-2 rounded hover:bg-gray-300"
          >
            Reset to Default
          </button>
        </div>
      </form>

      <div className="border border-gray-200 rounded-lg shadow-sm">
        <UnassignedViaAutoroutingPipelineDebugger srj={srj} />
      </div>
    </div>
  )
}
