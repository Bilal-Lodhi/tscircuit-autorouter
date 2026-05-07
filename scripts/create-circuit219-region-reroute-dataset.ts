#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import {
  AutoroutingPipelineSolver4,
  getRerouteSimpleRouteJson,
  type RerouteRectRegion,
} from "../lib"
import type { SimpleRouteJson } from "../lib/types"

const OUTPUT_DIR = path.join(process.cwd(), "fixtures/datasets/dataset-srj15")
const SAMPLE_COUNT = 25
const RANDOM_SEED = 219_015
const MIN_REGION_SIZE = 10
const MAX_REGION_SIZE = 20
const MAX_REGION_ATTEMPTS = 100
const GRID_COLUMNS = 5
const GRID_ROWS = 5
const DEFAULT_BOUNDS_EXPANSION = 0.15
const DEFAULT_MIN_OBSTACLE_DIMENSION = 0.3

const getCircuit219 = () =>
  (dataset01 as Record<string, unknown>).circuit219 as SimpleRouteJson

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const stringifyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const getStratifiedRandomRegion = (
  bounds: SimpleRouteJson["bounds"],
  random: () => number,
  sampleIndex: number,
): RerouteRectRegion => {
  const width = MIN_REGION_SIZE + random() * (MAX_REGION_SIZE - MIN_REGION_SIZE)
  const height =
    MIN_REGION_SIZE + random() * (MAX_REGION_SIZE - MIN_REGION_SIZE)
  const column = sampleIndex % GRID_COLUMNS
  const row = Math.floor(sampleIndex / GRID_COLUMNS) % GRID_ROWS
  const cellWidth = (bounds.maxX - bounds.minX) / GRID_COLUMNS
  const cellHeight = (bounds.maxY - bounds.minY) / GRID_ROWS
  const centerX = bounds.minX + (column + random()) * cellWidth
  const centerY = bounds.minY + (row + random()) * cellHeight
  const minX = centerX - width / 2
  const minY = centerY - height / 2

  return {
    shape: "rect",
    minX,
    maxX: minX + width,
    minY,
    maxY: minY + height,
  }
}

const roundRegion = (region: RerouteRectRegion): RerouteRectRegion => ({
  shape: "rect",
  minX: Number(region.minX.toFixed(3)),
  maxX: Number(region.maxX.toFixed(3)),
  minY: Number(region.minY.toFixed(3)),
  maxY: Number(region.maxY.toFixed(3)),
})

const normalizeSampleSrj = (
  sampleSrj: SimpleRouteJson,
): SimpleRouteJson => {
  return {
    ...sampleSrj,
    bounds: {
      minX: sampleSrj.bounds.minX - DEFAULT_BOUNDS_EXPANSION,
      maxX: sampleSrj.bounds.maxX + DEFAULT_BOUNDS_EXPANSION,
      minY: sampleSrj.bounds.minY - DEFAULT_BOUNDS_EXPANSION,
      maxY: sampleSrj.bounds.maxY + DEFAULT_BOUNDS_EXPANSION,
    },
    obstacles: sampleSrj.obstacles.map((obstacle) => ({
      ...obstacle,
      width: Math.max(obstacle.width, DEFAULT_MIN_OBSTACLE_DIMENSION),
      height: Math.max(obstacle.height, DEFAULT_MIN_OBSTACLE_DIMENSION),
    })),
  }
}

const main = async () => {
  const inputSrj = structuredClone(getCircuit219())
  const solver = new AutoroutingPipelineSolver4(inputSrj)
  solver.solve()

  if (!solver.solved || solver.failed) {
    throw new Error(`Pipeline4 failed to solve circuit219: ${solver.error}`)
  }

  const solvedSrj = solver.getOutputSimpleRouteJson()
  const random = createSeededRandom(RANDOM_SEED)
  const samples: Array<{
    file: string
    region: RerouteRectRegion
    rippedConnectionCount: number
    retainedTraceCount: number
  }> = []

  await mkdir(OUTPUT_DIR, { recursive: true })

  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex++) {
    let sampleSrj: SimpleRouteJson | null = null
    let region: RerouteRectRegion | null = null

    for (let attempt = 0; attempt < MAX_REGION_ATTEMPTS; attempt++) {
      const candidateRegion = roundRegion(
        getStratifiedRandomRegion(solvedSrj.bounds, random, sampleIndex),
      )
      const candidateSrj = getRerouteSimpleRouteJson(solvedSrj, candidateRegion)

      if (candidateSrj.connections.length === 0) continue

      sampleSrj = normalizeSampleSrj(candidateSrj)
      region = candidateRegion
      break
    }

    if (!sampleSrj || !region) {
      throw new Error(
        `Unable to generate sample ${sampleIndex + 1} with ripped routes`,
      )
    }

    const file = `sample${String(sampleIndex + 1).padStart(2, "0")}-region-reroute.srj.json`
    await writeFile(path.join(OUTPUT_DIR, file), stringifyJson(sampleSrj))

    samples.push({
      file,
      region,
      rippedConnectionCount: sampleSrj.connections.length,
      retainedTraceCount: sampleSrj.traces?.length ?? 0,
    })
  }

  await writeFile(
    path.join(OUTPUT_DIR, "manifest.json"),
    stringifyJson({
      sourceDataset: "dataset01",
      sourceCircuit: "circuit219",
      generatedWith: "AutoroutingPipelineSolver4",
      rerouteMethod: "getRerouteSimpleRouteJson",
      randomSeed: RANDOM_SEED,
      sampleCount: SAMPLE_COUNT,
      minRegionSize: MIN_REGION_SIZE,
      maxRegionSize: MAX_REGION_SIZE,
      gridColumns: GRID_COLUMNS,
      gridRows: GRID_ROWS,
      samples,
    }),
  )

  console.log(
    `Wrote ${SAMPLE_COUNT} samples to ${path.relative(process.cwd(), OUTPUT_DIR)}`,
  )
}

await main()
