import SegmentOptimizerDebugger from "lib/testing/SegmentOptimizerDebugger"
import inputs from "fixtures/legacy/assets/segmenttopoint4.json" with {
  type: "json",
}

export default function SegmentToPoint4Fixture() {
  return (
    <SegmentOptimizerDebugger
      segments={inputs.segments as any}
      colorMap={inputs.colorMap}
      nodes={inputs.nodes as any}
    />
  )
}
