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
const SAMPLE_COUNT = 10
const RANDOM_SEED = 219_015
const MIN_REGION_SIZE = 10
const MAX_REGION_SIZE = 20
const MAX_REGION_ATTEMPTS = 10_000
const MAX_RIPPED_CONNECTIONS_PER_SAMPLE = 4

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

const getRandomRegion = (
  bounds: SimpleRouteJson["bounds"],
  random: () => number,
): RerouteRectRegion => {
  const width = MIN_REGION_SIZE + random() * (MAX_REGION_SIZE - MIN_REGION_SIZE)
  const height =
    MIN_REGION_SIZE + random() * (MAX_REGION_SIZE - MIN_REGION_SIZE)
  const minX = bounds.minX + random() * (bounds.maxX - bounds.minX - width)
  const minY = bounds.minY + random() * (bounds.maxY - bounds.minY - height)

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

const hasReroutePointInsideRegion = (
  srj: SimpleRouteJson,
  region: RerouteRectRegion,
) =>
  srj.connections.some((connection) =>
    connection.pointsToConnect.some(
      (point) =>
        point.x > region.minX &&
        point.x < region.maxX &&
        point.y > region.minY &&
        point.y < region.maxY,
    ),
  )

const canSolveSample = (srj: SimpleRouteJson) => {
  const originalConsoleError = console.error
  try {
    console.error = () => {}
    const solver = new AutoroutingPipelineSolver4(structuredClone(srj))
    solver.solve()
    return solver.solved && !solver.failed
  } catch {
    return false
  } finally {
    console.error = originalConsoleError
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
        getRandomRegion(solvedSrj.bounds, random),
      )
      const candidateSrj = getRerouteSimpleRouteJson(solvedSrj, candidateRegion)

      if (candidateSrj.connections.length === 0) continue
      if (candidateSrj.connections.length > MAX_RIPPED_CONNECTIONS_PER_SAMPLE) {
        continue
      }
      if (hasReroutePointInsideRegion(candidateSrj, candidateRegion)) continue
      if (!canSolveSample(candidateSrj)) continue

      sampleSrj = candidateSrj
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
      maxRippedConnectionsPerSample: MAX_RIPPED_CONNECTIONS_PER_SAMPLE,
      validatedWith: "AutoroutingPipelineSolver4",
      samples,
    }),
  )

  console.log(
    `Wrote ${SAMPLE_COUNT} samples to ${path.relative(process.cwd(), OUTPUT_DIR)}`,
  )
}

await main()
