import SegmentOptimizerDebugger from "lib/testing/SegmentOptimizerDebugger"
import inputs from "fixtures/legacy/assets/segmenttopoint5.json" with {
  type: "json",
}

export default function SegmentToPoint5Fixture() {
  return (
    <SegmentOptimizerDebugger
      segments={inputs.assignedSegments}
      colorMap={inputs.colorMap}
      nodes={inputs.nodes as any}
    />
  )
}
