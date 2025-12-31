import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"

interface MetricsCardProps {
  totalConnections: number
  layerChanges: number
  capacity: string
  probabilityOfFailure: string
  diagnostics: ReturnType<typeof getIntraNodeCrossings>
}

export function MetricsCard(props: MetricsCardProps) {
  const {
    totalConnections,
    layerChanges,
    capacity,
    probabilityOfFailure,
    diagnostics,
  } = props

  const coreMetrics = [
    { label: "Connections", value: totalConnections.toString() },
    { label: "Layer Changes", value: layerChanges.toString() },
    { label: "Capacity", value: capacity },
    { label: "Failure Risk", value: `${probabilityOfFailure}%` },
  ]

  const crossingMetrics = [
    {
      label: "Same Layer (XSame)",
      value: diagnostics.numSameLayerCrossings.toString(),
    },
    {
      label: "Entry/Exit Changes (XLC) ",
      value: diagnostics.numEntryExitLayerChanges.toString(),
    },
    {
      label: "Transition Crossings (XTransition)",
      value: diagnostics.numTransitionPairCrossings.toString(),
    },
  ]

  return (
    <foreignObject x="20" y="20" width="260" height="400">
      <div className="bg-gray-900/90 text-white rounded-2xl border border-white/10 shadow-xl p-4 w-full h-full flex flex-col">
        <div className="text-xs uppercase tracking-wide text-gray-400">
          Node Metrics
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {coreMetrics.map((metric) => (
            <div
              key={metric.label}
              className="bg-white/5 rounded-xl px-3 py-2 flex flex-col"
            >
              <span className="text-[11px] font-medium text-gray-400">
                {metric.label}
              </span>
              <span className="text-lg font-semibold">{metric.value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs uppercase tracking-wide text-gray-400">
          Intra-node Crossings
        </div>
        <div className="mt-2 space-y-2">
          {crossingMetrics.map((metric) => (
            <div
              key={metric.label}
              className="flex items-center justify-between bg-white/5 rounded-xl px-3 py-2"
            >
              <span className="text-sm text-gray-300">{metric.label}</span>
              <span className="text-lg font-semibold">{metric.value}</span>
            </div>
          ))}
        </div>
      </div>
    </foreignObject>
  )
}
