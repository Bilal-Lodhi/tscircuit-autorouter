import input19 from "./expansion_degrees_bug_bugreport19.json" with {
  type: "json",
}
import input1 from "./expansion_degrees_bug_bugreport1.json" with {
  type: "json",
}
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  MultiSectionPortPointOptimizer,
  type MultiSectionPortPointOptimizerParams,
} from "lib/solvers/MultiSectionPortPointOptimizer"
import type { PortPoint } from "lib/types/high-density-types"

const EXPANSION_DEGREE = 1

type SerializedAssignedPortPoint = {
  connectionName: string
  rootConnectionName?: string
}

type SerializedParams = Omit<
  MultiSectionPortPointOptimizerParams,
  "initialAssignedPortPoints" | "initialNodeAssignedPortPoints"
> & {
  initialAssignedPortPoints: Record<string, SerializedAssignedPortPoint>
  initialNodeAssignedPortPoints: Record<string, PortPoint[]>
}

function deserializeParams(
  serialized: SerializedParams,
): MultiSectionPortPointOptimizerParams {
  return {
    ...serialized,
    initialAssignedPortPoints: new Map(
      Object.entries(serialized.initialAssignedPortPoints),
    ),
    initialNodeAssignedPortPoints: new Map(
      Object.entries(serialized.initialNodeAssignedPortPoints) as [
        string,
        PortPoint[],
      ][],
    ),
  }
}

test("expansion degree 1 snapshot bugreport19", () => {
  const [serializedParams] = input19 as unknown as SerializedParams[]
  const optimizer = new MultiSectionPortPointOptimizer(
    deserializeParams(serializedParams),
  )

  const originalCreateSection = optimizer.createSection.bind(optimizer)
  optimizer.createSection = (params) =>
    originalCreateSection({
      ...params,
      expansionDegrees: EXPANSION_DEGREE,
    })

  optimizer.solve()

  const svg = getSvgFromGraphicsObject(optimizer.visualize(), {
    backgroundColor: "white",
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path + "19")
})

test("expansion degree 1 snapshot bugreport1", () => {
  const [serializedParams] = input1 as unknown as SerializedParams[]
  const optimizer = new MultiSectionPortPointOptimizer(
    deserializeParams(serializedParams),
  )

  const originalCreateSection = optimizer.createSection.bind(optimizer)
  optimizer.createSection = (params) =>
    originalCreateSection({
      ...params,
      expansionDegrees: EXPANSION_DEGREE,
    })

  optimizer.solve()

  const svg = getSvgFromGraphicsObject(optimizer.visualize(), {
    backgroundColor: "white",
  })

  expect(svg).toMatchSvgSnapshot(import.meta.path + "1")
})
