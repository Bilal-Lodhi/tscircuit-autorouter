import { expect, test } from "bun:test"
import type {
  SerializedGraphPort,
  SerializedGraphRegion,
} from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsVertically } from "stack-svgs"
import {
  extractSectionOfHyperGraph,
  type SerializedHyperGraphWithSolvedRoutes,
  visualizeSerializedHyperGraph,
} from "lib/index"

function createRegion(
  regionId: string,
  center: { x: number; y: number },
): SerializedGraphRegion {
  return {
    regionId,
    pointIds: [],
    d: {
      center,
      width: 2,
      height: 2,
    },
  }
}

function createPort(params: {
  portId: string
  region1Id: string
  region2Id: string
  x: number
  y: number
}): SerializedGraphPort {
  return {
    portId: params.portId,
    region1Id: params.region1Id,
    region2Id: params.region2Id,
    d: {
      x: params.x,
      y: params.y,
      z: 0,
    },
  }
}

test("extractSectionOfHyperGraph clips a solved route to the selected section", async () => {
  const regions: SerializedGraphRegion[] = [
    createRegion("r1", { x: 1, y: 1 }),
    createRegion("r2", { x: 3, y: 1 }),
    createRegion("r3", { x: 5, y: 1 }),
    createRegion("r4", { x: 3, y: 3 }),
    createRegion("r5", { x: 5, y: 3 }),
    createRegion("r6", { x: 7, y: 3 }),
  ]

  const ports: SerializedGraphPort[] = [
    createPort({
      portId: "route-start",
      region1Id: "outside-left",
      region2Id: "r1",
      x: 0,
      y: 1.05,
    }),
    createPort({
      portId: "route-entry",
      region1Id: "r1",
      region2Id: "r2",
      x: 2,
      y: 1.1,
    }),
    createPort({
      portId: "route-mid-a",
      region1Id: "r2",
      region2Id: "r4",
      x: 3,
      y: 2,
    }),
    createPort({
      portId: "route-mid-b",
      region1Id: "r4",
      region2Id: "r5",
      x: 4,
      y: 3,
    }),
    createPort({
      portId: "route-exit",
      region1Id: "r5",
      region2Id: "r6",
      x: 6,
      y: 3.3,
    }),
    createPort({
      portId: "route-end",
      region1Id: "r6",
      region2Id: "outside-right",
      x: 8,
      y: 2.95,
    }),
    createPort({
      portId: "top-bridge",
      region1Id: "r2",
      region2Id: "r3",
      x: 4,
      y: 1.15,
    }),
    createPort({
      portId: "right-vertical-top",
      region1Id: "r3",
      region2Id: "outside-top-right",
      x: 6,
      y: 0.45,
    }),
    createPort({
      portId: "right-vertical-mid",
      region1Id: "r3",
      region2Id: "outside-mid-right",
      x: 6,
      y: 1.75,
    }),
    createPort({
      portId: "bottom-left-a",
      region1Id: "r4",
      region2Id: "outside-bottom-left",
      x: 2.55,
      y: 4,
    }),
    createPort({
      portId: "bottom-left-b",
      region1Id: "r4",
      region2Id: "outside-bottom-left",
      x: 3.45,
      y: 4,
    }),
    createPort({
      portId: "bottom-right-a",
      region1Id: "r5",
      region2Id: "outside-bottom-right",
      x: 4.6,
      y: 4,
    }),
    createPort({
      portId: "bottom-right-b",
      region1Id: "r5",
      region2Id: "outside-bottom-right",
      x: 5.55,
      y: 4,
    }),
  ]

  const portsByRegionId = new Map<string, string[]>()

  for (const region of regions) {
    portsByRegionId.set(region.regionId, [])
  }

  for (const port of ports) {
    if (portsByRegionId.has(port.region1Id)) {
      portsByRegionId.get(port.region1Id)!.push(port.portId)
    }
    if (portsByRegionId.has(port.region2Id)) {
      portsByRegionId.get(port.region2Id)!.push(port.portId)
    }
  }

  for (const region of regions) {
    region.pointIds = portsByRegionId.get(region.regionId) ?? []
  }

  const fullGraph: SerializedHyperGraphWithSolvedRoutes = {
    regions,
    ports,
    solvedRoutes: [
      {
        connectionId: "route-1",
        pathPortIds: [
          "route-start",
          "route-entry",
          "route-mid-a",
          "route-mid-b",
          "route-exit",
          "route-end",
        ],
      },
    ],
  }

  const sectionGraph = extractSectionOfHyperGraph(fullGraph, {
    regionIds: ["r2", "r3", "r4", "r5"],
  })

  expect(sectionGraph.regions.map((region) => region.regionId)).toEqual([
    "r2",
    "r3",
    "r4",
    "r5",
  ])
  expect(sectionGraph.solvedRoutes).toEqual([
    {
      connectionId: "route-1",
      pathPortIds: ["route-entry", "route-mid-a", "route-mid-b", "route-exit"],
    },
  ])

  const fullGraphSvg = getSvgFromGraphicsObject(
    visualizeSerializedHyperGraph(fullGraph, {
      title: "Full graph",
      lineWidth: 0.028,
      portRadius: 0.08,
    }),
    {
      svgWidth: 1200,
      svgHeight: 420,
    },
  )

  const sectionSvg = getSvgFromGraphicsObject(
    visualizeSerializedHyperGraph(sectionGraph, {
      title: "Section",
      highlightSolvedRoutePorts: true,
      lineWidth: 0.028,
      portRadius: 0.08,
    }),
    {
      svgWidth: 1200,
      svgHeight: 420,
    },
  )

  const stackedSvg = stackSvgsVertically([fullGraphSvg, sectionSvg], {
    gap: 80,
    normalizeSize: false,
  })

  await expect(stackedSvg).toMatchSvgSnapshot(import.meta.path)
})
