import { Rect } from "graphics-debug"
import { CapacityMeshSolver } from "lib/solvers/AutoroutingPipelineSolver"
import { getNodesNearNode } from "lib/solvers/UnravelSolver/getNodesNearNode"
import { getNodeDebugData } from "./utils/getNodeDebugData"
import { filterUnravelMultiSectionInput } from "./utils/filterUnravelMultiSectionInput"

interface NodeDebugDialogProps {
  dialogObject: Rect & { step?: number; label?: string | null }
  solver: CapacityMeshSolver
  onClose: () => void
}

type JsonReplacer = (this: unknown, key: string, value: unknown) => unknown

const downloadJson = (
  data: unknown,
  filename: string,
  replacer?: JsonReplacer,
) => {
  const json = JSON.stringify(data, replacer, 2)
  const dataBlob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(dataBlob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const NodeDebugDialog = ({
  dialogObject,
  solver,
  onClose,
}: NodeDebugDialogProps) => {
  const handleDownloadNodeInput = () => {
    const nodeData = getNodeDebugData({
      solver,
      label: dialogObject?.label,
    })
    if (!nodeData?.nodeId || !nodeData.nodeWithPortPoints) return

    downloadJson(
      {
        nodeId: nodeData.nodeId,
        capacityMeshNode: nodeData.nodeData,
        nodeWithPortPoints: nodeData.nodeWithPortPoints,
      },
      `${nodeData.nodeId}-nodeWithPortPoints.json`,
    )
  }

  const openDebugger = (fixtureId: string) => {
    const nodeData = getNodeDebugData({
      solver,
      label: dialogObject?.label,
    })
    if (!nodeData?.nodeWithPortPoints) return

    const url = new URL(window.location.href)
    url.searchParams.set("fixtureId", fixtureId)
    url.searchParams.set(
      "nodeWithPortPoints",
      JSON.stringify(nodeData.nodeWithPortPoints),
    )

    window.open(url.toString(), "_blank")
  }

  const handleDownloadUnravelSectionInput = () => {
    if (!dialogObject.label) return

    const match = dialogObject.label.match(/cn(\d+)/)
    if (!match) return

    const nodeId = `cn${parseInt(match[1], 10)}`
    const umss = solver.unravelMultiSectionSolver
    if (!umss) return

    const verboseInput = {
      dedupedSegments: umss.dedupedSegments,
      dedupedSegmentMap: umss.dedupedSegmentMap,
      nodeMap: umss.nodeMap,
      nodeIdToSegmentIds: umss.nodeIdToSegmentIds,
      segmentIdToNodeIds: umss.segmentIdToNodeIds,
      colorMap: umss.colorMap,
      rootNodeId: nodeId,
      MUTABLE_HOPS: umss.MUTABLE_HOPS,
      segmentPointMap: umss.segmentPointMap,
      nodeToSegmentPointMap: umss.nodeToSegmentPointMap,
      segmentToSegmentPointMap: umss.segmentToSegmentPointMap,
    }

    const relevantNodeIds = new Set(
      getNodesNearNode({
        nodeId,
        nodeIdToSegmentIds: umss.nodeIdToSegmentIds,
        segmentIdToNodeIds: umss.segmentIdToNodeIds,
        hops: 8,
      }),
    )

    const filteredVerboseInput = filterUnravelMultiSectionInput(
      verboseInput,
      relevantNodeIds,
    )

    downloadJson(
      filteredVerboseInput,
      `unravel_section_${nodeId}_input.json`,
      (key: string, value: unknown) => {
        if (value instanceof Map) {
          return Object.fromEntries(value)
        }
        return value
      },
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-4 rounded-lg shadow-lg max-w-3xl max-h-[80vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">
            Selected Object "{dialogObject.label?.split("\n")[0]}" (step{" "}
            {dialogObject.step})
          </h3>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div>
          <div className="mb-4 flex flex-col">
            <pre className="bg-gray-100 p-3 rounded overflow-auto max-h-96 text-sm">
              {dialogObject.label}
            </pre>
            <button
              className="mt-2 bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
              onClick={handleDownloadNodeInput}
            >
              Download High Density Node Input (NodeWithPortPoints)
            </button>
            <button
              className="mt-2 bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
              onClick={() =>
                openDebugger(
                  "examples/debuggers/hyper-high-density-debugger.fixture.tsx",
                )
              }
            >
              Open in HyperHighDensityDebugger
            </button>
            <button
              className="mt-2 bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
              onClick={() =>
                openDebugger(
                  "examples/debuggers/high-density-debugger.fixture.tsx",
                )
              }
            >
              Open in HighDensityDebugger
            </button>
            <button
              className="mt-2 bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
              onClick={handleDownloadUnravelSectionInput}
            >
              Download Unravel Section Input
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
