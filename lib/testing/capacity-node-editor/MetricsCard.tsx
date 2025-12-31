import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"

type MetricsCardProps = ReturnType<typeof getIntraNodeCrossings> & {
  probabilityOfFailure: number
}

export function MetricsCard(props: MetricsCardProps) {
  const {
    numEntryExitLayerChanges,
    numSameLayerCrossings,
    numTransitionPairCrossings,
  } = props

  const crossingMetrics = [
    {
      label: "Same Layer (XSame)",
      value: numSameLayerCrossings.toString(),
    },
    {
      label: "Entry/Exit Changes (XLC) ",
      value: numEntryExitLayerChanges.toString(),
    },
    {
      label: "Transition Crossings (XTransition)",
      value: numTransitionPairCrossings.toString(),
    },
    {
      label: "Probability of Failure",
      value: props.probabilityOfFailure.toFixed(4),
    },
  ]

  return (
    <foreignObject x="20" y="20" width="260" height="250">
      <div className="bg-gray-900/90 text-white rounded-2xl border border-white/10 shadow-xl p-4 w-full h-full flex flex-col">
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
