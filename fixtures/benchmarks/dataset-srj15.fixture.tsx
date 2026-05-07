import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"
import manifest from "../datasets/dataset-srj15/manifest.json" with {
  type: "json",
}
import { useMemo, useState } from "react"

const samplePathPattern = /\/sample(\d+)-region-reroute\.srj\.json$/
const DEFAULT_BOUNDS_EXPANSION = 0.15
const DEFAULT_MIN_OBSTACLE_DIMENSION = 0.3

const applyBoundsMargin = (
  srj: DatasetCircuit["srj"],
  margin: number,
  baseBounds: DatasetCircuit["srj"]["bounds"],
): DatasetCircuit["srj"] => ({
  ...srj,
  bounds: {
    minX: baseBounds.minX - margin,
    maxX: baseBounds.maxX + margin,
    minY: baseBounds.minY - margin,
    maxY: baseBounds.maxY + margin,
  },
})

const applyMinimumObstacleDimension = (
  srj: DatasetCircuit["srj"],
  minObstacleDimension: number,
): DatasetCircuit["srj"] => ({
  ...srj,
  obstacles: srj.obstacles.map((obstacle) => ({
    ...obstacle,
    width: Math.max(obstacle.width, minObstacleDimension),
    height: Math.max(obstacle.height, minObstacleDimension),
  })),
})

// @ts-ignore
const srjModules = import.meta.glob("../datasets/dataset-srj15/*.srj.json", {
  eager: true,
  import: "default",
}) as Record<string, DatasetCircuit["srj"]>

const baseCircuits = Object.entries(srjModules)
  .map(([path, srj]) => {
    const sampleMatch = path.match(samplePathPattern)
    if (!sampleMatch) return null

    return {
      id: sampleMatch[1].padStart(3, "0"),
      srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

const baseBoundsById = new Map(
  manifest.samples.map((sample) => {
    const sampleMatch = sample.file.match(/sample(\d+)-region-reroute\.srj\.json$/)
    const id = sampleMatch ? sampleMatch[1].padStart(3, "0") : sample.file
    return [
      id,
      {
        minX: sample.region.minX,
        maxX: sample.region.maxX,
        minY: sample.region.minY,
        maxY: sample.region.maxY,
      },
    ]
  }),
)

export default () => {
  const [marginInput, setMarginInput] = useState(
    DEFAULT_BOUNDS_EXPANSION.toString(),
  )
  const [minObstacleDimensionInput, setMinObstacleDimensionInput] = useState(
    DEFAULT_MIN_OBSTACLE_DIMENSION.toString(),
  )
  const parsedMargin = Number(marginInput)
  const margin =
    Number.isFinite(parsedMargin) && parsedMargin >= 0
      ? parsedMargin
      : DEFAULT_BOUNDS_EXPANSION
  const parsedMinObstacleDimension = Number(minObstacleDimensionInput)
  const minObstacleDimension =
    Number.isFinite(parsedMinObstacleDimension) &&
    parsedMinObstacleDimension >= 0
      ? parsedMinObstacleDimension
      : DEFAULT_MIN_OBSTACLE_DIMENSION

  const circuits = useMemo(
    () =>
      baseCircuits.map((circuit) => {
        const baseBounds = baseBoundsById.get(circuit.id) ?? circuit.srj.bounds
        const srjWithBoundsMargin = applyBoundsMargin(
          circuit.srj,
          margin,
          baseBounds,
        )
        return {
          ...circuit,
          srj: applyMinimumObstacleDimension(
            srjWithBoundsMargin,
            minObstacleDimension,
          ),
          renderKey: `${circuit.id}:${margin}:${minObstacleDimension}`,
        }
      }),
    [margin, minObstacleDimension],
  )

  return (
    <DatasetBenchmarkFixture
      datasetLabel="dataset-srj15"
      circuits={circuits}
      controls={
        <>
          <label>
            Bounds Margin:{" "}
            <input
              type="number"
              step="0.1"
              min="0"
              value={marginInput}
              onChange={(e) => setMarginInput(e.currentTarget.value)}
              style={{ width: 72 }}
            />
          </label>{" "}
          <label>
            Min Obstacle Dim:{" "}
            <input
              type="number"
              step="0.1"
              min="0"
              value={minObstacleDimensionInput}
              onChange={(e) => setMinObstacleDimensionInput(e.currentTarget.value)}
              style={{ width: 72 }}
            />
          </label>
        </>
      }
    />
  )
}
