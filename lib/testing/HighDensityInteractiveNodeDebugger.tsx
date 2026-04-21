import { useEffect, useState } from "react"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import CapacityNodeEditor from "lib/testing/CapacityNodeEditor"
import {
  cloneNodeWithPortPoints,
  getInteractiveHighDensitySolveNode,
  type InteractiveHighDensitySolveNodeSource,
} from "lib/testing/utils/interactiveHighDensityNode"

export interface HighDensityInteractiveNodeDebuggerProps {
  nodeWithPortPoints: NodeWithPortPoints
}

export const HighDensityInteractiveNodeDebugger = ({
  nodeWithPortPoints,
}: HighDensityInteractiveNodeDebuggerProps) => {
  const [editableNode, setEditableNode] = useState<NodeWithPortPoints>(() =>
    cloneNodeWithPortPoints(nodeWithPortPoints),
  )
  const [mode, setMode] = useState<"build" | "solve">("build")
  const [animationSpeed, setAnimationSpeed] = useState<number>(10)
  const [solveNodeSource, setSolveNodeSource] =
    useState<InteractiveHighDensitySolveNodeSource>("uploaded")
  const [solverAction, setSolverAction] = useState<
    "reset" | "step" | "animate" | "solve" | null
  >(null)

  useEffect(() => {
    setEditableNode(cloneNodeWithPortPoints(nodeWithPortPoints))
    setMode("build")
    setSolverAction(null)
    setSolveNodeSource("uploaded")
  }, [nodeWithPortPoints])

  const solveNode = getInteractiveHighDensitySolveNode({
    source: solveNodeSource,
    uploadedNode: nodeWithPortPoints,
    editedNode: editableNode,
  })

  const solveNodeSummary = `${solveNode.capacityMeshNodeId} • ${solveNode.portPoints.length} ports`

  return (
    <div className="flex flex-col h-screen">
      <div className="p-2 border-b bg-white flex items-center justify-between shadow-sm z-10">
        <div className="flex gap-2">
          <button
            className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300"
            onClick={() => {
              setMode("build")
              setSolverAction(null)
            }}
          >
            Reset
          </button>
          <button
            className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300"
            onClick={() => {
              setMode("solve")
              setSolverAction("step")
            }}
          >
            Step
          </button>
          <button
            className={`px-3 py-1 text-sm rounded ${
              mode === "solve" && solverAction === "animate"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
            onClick={() => {
              if (mode === "solve" && solverAction === "animate") {
                setSolverAction(null)
              } else {
                setMode("solve")
                setSolverAction("animate")
              }
            }}
          >
            Animate
          </button>
          <button
            className="px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300"
            onClick={() => {
              setMode("solve")
              setSolverAction("solve")
            }}
          >
            Solve
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs">Speed:</span>
          <select
            className="px-2 py-1 text-sm border rounded"
            value={animationSpeed}
            onChange={(e) => setAnimationSpeed(Number(e.target.value))}
          >
            <option value={1000}>1000ms</option>
            <option value={500}>500ms</option>
            <option value={250}>250ms</option>
            <option value={100}>100ms (1x)</option>
            <option value={25}>25ms (4x)</option>
            <option value={10}>10ms (10x)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs">Solve Input:</span>
          <button
            className={`px-2 py-1 text-xs rounded ${
              solveNodeSource === "uploaded"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
            onClick={() => setSolveNodeSource("uploaded")}
          >
            Uploaded ({nodeWithPortPoints.portPoints.length} ports)
          </button>
          <button
            className={`px-2 py-1 text-xs rounded ${
              solveNodeSource === "edited"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
            onClick={() => setSolveNodeSource("edited")}
          >
            Edited ({editableNode.portPoints.length} ports)
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {mode === "build" ? (
          <CapacityNodeEditor
            onNodeChange={setEditableNode}
            initialNode={nodeWithPortPoints}
          />
        ) : (
          <div className="h-full overflow-auto p-4">
            <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Solving{" "}
              <b>
                {solveNodeSource === "uploaded"
                  ? "uploaded raw node"
                  : "edited node"}
              </b>
              : {solveNodeSummary}
            </div>
            <HyperHighDensityDebugger
              nodeWithPortPoints={solveNode}
              solverAction={solverAction}
              animationSpeed={animationSpeed}
              onActionComplete={() => setSolverAction(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
