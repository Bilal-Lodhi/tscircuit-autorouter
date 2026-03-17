import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"

test("should produce last-step svg for e2e3 hg pipeline", () => {
  const simpleSrj = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(simpleSrj)
  solver.solve()

  const output = solver.portPointPathingSolver?.getOutput()
  expect(output).toBeDefined()
  const nodesWithPortPoints = output!.nodesWithPortPoints
  const inputNodeWithPortPoints = output!.inputNodeWithPortPoints

  const cmn10Input = inputNodeWithPortPoints.find(
    (node) => node.capacityMeshNodeId === "cmn_10",
  )
  expect(cmn10Input).toBeDefined()
  const cmn10To12PortPointIds = (cmn10Input?.portPoints ?? [])
    .filter(
      (point) =>
        point.portPointId &&
        point.connectionNodeIds.includes("cmn_12") &&
        point.connectionNodeIds.includes("cmn_10"),
    )
    .map((point) => point.portPointId as string)
  expect(cmn10To12PortPointIds.length).toBeGreaterThan(0)

  const cmn10PortPointIds = new Set(
    nodesWithPortPoints
      .filter((node) => node.capacityMeshNodeId === "cmn_10")
      .flatMap((node) => node.portPoints)
      .map((point) => point.portPointId)
      .filter((id): id is string => Boolean(id)),
  )

  for (const portPointId of cmn10To12PortPointIds) {
    expect(cmn10PortPointIds.has(portPointId)).toBe(true)
  }

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 20_000)
