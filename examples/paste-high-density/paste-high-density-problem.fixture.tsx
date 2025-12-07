import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { useState } from "react"

type DebuggerType = "high-density" | "hyper-high-density" | null

interface HighDensityNodeDownload {
  nodeId: string
  capacityMeshNode: unknown
  nodeWithPortPoints: NodeWithPortPoints
}

const sampleJson: HighDensityNodeDownload = {
  nodeId: "cmn_25",
  capacityMeshNode: null,
  nodeWithPortPoints: {
    capacityMeshNodeId: "cmn_25",
    portPoints: [
      {
        x: 43.995676549999985,
        y: 3.790005400000032,
        z: 0,
        connectionName: "source_net_12_mst3",
        availableZ: [0, 1],
      },
      {
        x: 45.17303055000003,
        y: -6.755002999999904,
        z: 1,
        connectionName: "source_net_11_mst0",
        availableZ: [0, 1],
      },
      {
        x: 47.643035,
        y: -5.552504299999953,
        z: 1,
        connectionName: "source_net_15_mst9",
        availableZ: [0, 1],
      },
      {
        x: 31.938215000000014,
        y: -3.9750000000000014,
        z: 1,
        connectionName: "source_net_15_mst9",
        availableZ: [0, 1],
      },
    ],
    center: {
      x: 39.790625000000006,
      y: -1.4824987999999362,
    },
    width: 15.704819999999984,
    height: 10.545008399999936,
    availableZ: [0, 1],
  },
}

export default () => {
  const [nodeWithPortPoints, setNodeWithPortPoints] =
    useState<NodeWithPortPoints | null>(null)
  const [selectedDebugger, setSelectedDebugger] = useState<DebuggerType>(null)
  const [error, setError] = useState<string | null>(null)

  const handleTextareaInput = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setError(null)
    try {
      const json = JSON.parse(event.target.value)
      // Support both direct nodeWithPortPoints or the full download format
      if (json.nodeWithPortPoints) {
        setNodeWithPortPoints(json.nodeWithPortPoints)
      } else if (json.capacityMeshNodeId && json.portPoints) {
        // Direct NodeWithPortPoints format
        setNodeWithPortPoints(json)
      } else {
        setError(
          "Invalid format. Expected either a high density node download or a NodeWithPortPoints object.",
        )
      }
    } catch (e) {
      // Don't show error while typing
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const textarea = event.currentTarget.querySelector("textarea")
    if (!textarea) return

    try {
      const json = JSON.parse(textarea.value)
      if (json.nodeWithPortPoints) {
        setNodeWithPortPoints(json.nodeWithPortPoints)
        setError(null)
      } else if (json.capacityMeshNodeId && json.portPoints) {
        setNodeWithPortPoints(json)
        setError(null)
      } else {
        setError(
          "Invalid format. Expected either a high density node download or a NodeWithPortPoints object.",
        )
      }
    } catch (e) {
      setError("Invalid JSON! Please enter valid JSON.")
    }
  }

  const handleReset = () => {
    setNodeWithPortPoints(null)
    setSelectedDebugger(null)
    setError(null)
  }

  const handleBackToSelection = () => {
    setSelectedDebugger(null)
  }

  // Show debugger if both data and debugger type are selected
  if (nodeWithPortPoints && selectedDebugger) {
    return (
      <div>
        <button
          className="border p-2 m-2 bg-gray-200 hover:bg-gray-300"
          onClick={handleBackToSelection}
        >
          Back to Debugger Selection
        </button>
        <button
          className="border p-2 m-2 bg-gray-200 hover:bg-gray-300"
          onClick={handleReset}
        >
          Back to Paste
        </button>
        {selectedDebugger === "high-density" && (
          <HighDensityDebugger nodeWithPortPoints={nodeWithPortPoints} />
        )}
        {selectedDebugger === "hyper-high-density" && (
          <HyperHighDensityDebugger nodeWithPortPoints={nodeWithPortPoints} />
        )}
      </div>
    )
  }

  // Show debugger selection if data is loaded but no debugger selected
  if (nodeWithPortPoints && !selectedDebugger) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Select Debugger</h1>
        <p className="mb-6">
          Choose which debugger to use for visualizing the high density routing
          problem.
        </p>
        <div className="flex gap-4">
          <button
            className="border-2 p-4 rounded-lg hover:bg-blue-50 hover:border-blue-500 flex-1"
            onClick={() => setSelectedDebugger("high-density")}
          >
            <h3 className="font-bold text-lg mb-2">Load High Density Debugger</h3>
            <p className="text-sm text-gray-600">
              Single solver with seed shuffling and animation controls.
            </p>
          </button>
          <button
            className="border-2 p-4 rounded-lg hover:bg-blue-50 hover:border-blue-500 flex-1"
            onClick={() => setSelectedDebugger("hyper-high-density")}
          >
            <h3 className="font-bold text-lg mb-2">Load HyperHighDensity Debugger</h3>
            <p className="text-sm text-gray-600">
              Multiple solvers with different hyperparameters running in
              parallel.
            </p>
          </button>
        </div>
        <button
          className="mt-6 border p-2 bg-gray-200 hover:bg-gray-300 rounded"
          onClick={handleReset}
        >
          Back to Paste
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Paste High Density Problem</h1>
      <p className="mb-6">
        Paste a high density node download JSON to debug the high density
        routing solver. You can get this JSON by clicking "Download Node Data"
        on a high density node in the autorouting debugger.
      </p>

      <form onSubmit={handleSubmit}>
        <textarea
          className="w-full h-96 p-3 border border-gray-300 rounded-lg font-mono text-sm"
          placeholder="Paste your high density node JSON here..."
          onChange={handleTextareaInput}
          defaultValue={JSON.stringify(sampleJson, null, 2)}
        />
        {error && <p className="text-red-500 mt-2">{error}</p>}
        <button
          type="submit"
          className="mt-3 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Load JSON
        </button>
      </form>

      <div className="mt-10 p-4 bg-gray-100 rounded-lg">
        <h2 className="text-xl font-semibold mb-3">Expected JSON Format</h2>
        <p className="mb-2">
          The JSON should be a high density node download with the following
          structure:
        </p>
        <pre className="bg-gray-200 p-3 rounded text-sm overflow-auto">
          {`{
  "nodeId": "cmn_25",
  "capacityMeshNode": null,
  "nodeWithPortPoints": {
    "capacityMeshNodeId": "cmn_25",
    "portPoints": [
      {
        "x": 43.99,
        "y": 3.79,
        "z": 0,
        "connectionName": "source_net_12_mst3",
        "availableZ": [0, 1]
      },
      ...
    ],
    "center": { "x": 39.79, "y": -1.48 },
    "width": 15.7,
    "height": 10.5,
    "availableZ": [0, 1]
  }
}`}
        </pre>
      </div>
    </div>
  )
}
