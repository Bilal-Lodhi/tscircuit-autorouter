import { expect, test } from "bun:test"
import srj15Manifest from "../fixtures/datasets/dataset-srj15/manifest.json" with {
  type: "json",
}
import {
  loadScenarioBySampleNumber,
  loadScenarios,
  parseDatasetName,
} from "../scripts/benchmark/scenarios"
import type { Obstacle } from "../lib/types"

test("benchmark dataset aliases resolve to canonical dataset names", () => {
  expect(parseDatasetName("1")).toBe("dataset01")
  expect(parseDatasetName("dataset01")).toBe("dataset01")
  expect(parseDatasetName("11")).toBe("srj11")
  expect(parseDatasetName("dataset-srj11-45-degree")).toBe("srj11")
  expect(parseDatasetName("12")).toBe("srj12")
  expect(parseDatasetName("dataset-srj12-bus-routing")).toBe("srj12")
  expect(parseDatasetName("13")).toBe("srj13")
  expect(parseDatasetName("dataset-srj13")).toBe("srj13")
  expect(parseDatasetName("15")).toBe("srj15")
  expect(parseDatasetName("dataset-srj15")).toBe("srj15")
})

test("srj11, srj12, srj13, and srj15 benchmark datasets load in sample order", async () => {
  const srj11Scenarios = await loadScenarios("srj11")
  const srj12Scenarios = await loadScenarios("srj12")
  const srj13Scenarios = await loadScenarios("srj13")
  const srj15Scenarios = await loadScenarios("srj15")

  expect(srj11Scenarios).toHaveLength(20)
  expect(srj11Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj11Scenarios[19][0]).toBe("sample020Circuit")
  expect(srj11Scenarios[0][1].bounds).toBeDefined()

  expect(srj12Scenarios).toHaveLength(10)
  expect(srj12Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj12Scenarios[9][0]).toBe("sample010Circuit")
  expect(srj12Scenarios[0][1].bounds).toBeDefined()

  expect(srj13Scenarios).toHaveLength(50)
  expect(srj13Scenarios[0][0]).toBe("example_01")
  expect(srj13Scenarios[49][0]).toBe("example_50")
  expect(srj13Scenarios[0][1].bounds).toBeDefined()

  expect(srj15Scenarios).toHaveLength(25)
  expect(srj15Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj15Scenarios[24][0]).toBe("sample025Circuit")
  expect(srj15Scenarios[0][1].connections.length).toBeGreaterThan(0)

  const sample11 = await loadScenarioBySampleNumber("srj11", 11)
  expect(sample11.scenarioName).toBe("sample011Circuit")
  expect(sample11.totalSamples).toBe(20)

  const sample13 = await loadScenarioBySampleNumber("srj13", 13)
  expect(sample13.scenarioName).toBe("example_13")
  expect(sample13.totalSamples).toBe(50)
})

const isRerouteEndpointObstacle = (obstacle: Obstacle) =>
  obstacle.obstacleId?.includes("route_endpoint_") === true

const DEFAULT_SRJ15_BOUNDS_EXPANSION = 5
const DEFAULT_SRJ15_MIN_OBSTACLE_DIMENSION = 0

test("srj15 reroute endpoint obstacles stay fully inside sample bounds", async () => {
  const srj15Scenarios = await loadScenarios("srj15")
  let rerouteEndpointCount = 0

  for (const [, scenario] of srj15Scenarios) {
    for (const obstacle of scenario.obstacles) {
      if (!isRerouteEndpointObstacle(obstacle)) {
        continue
      }

      rerouteEndpointCount += 1

      const minX = obstacle.center.x - obstacle.width / 2
      const maxX = obstacle.center.x + obstacle.width / 2
      const minY = obstacle.center.y - obstacle.height / 2
      const maxY = obstacle.center.y + obstacle.height / 2

      expect(minX).toBeGreaterThanOrEqual(scenario.bounds.minX)
      expect(maxX).toBeLessThanOrEqual(scenario.bounds.maxX)
      expect(minY).toBeGreaterThanOrEqual(scenario.bounds.minY)
      expect(maxY).toBeLessThanOrEqual(scenario.bounds.maxY)
    }
  }

  expect(rerouteEndpointCount).toBeGreaterThan(0)
})

test("srj15 sample bounds expand the manifest region by the default margin", async () => {
  const srj15Scenarios = await loadScenarios("srj15")

  expect(srj15Scenarios).toHaveLength(srj15Manifest.samples.length)

  for (const [index, [, scenario]] of srj15Scenarios.entries()) {
    const manifestSample = srj15Manifest.samples[index]

    expect(scenario.bounds.minX).toBe(
      manifestSample.region.minX - DEFAULT_SRJ15_BOUNDS_EXPANSION,
    )
    expect(scenario.bounds.maxX).toBe(
      manifestSample.region.maxX + DEFAULT_SRJ15_BOUNDS_EXPANSION,
    )
    expect(scenario.bounds.minY).toBe(
      manifestSample.region.minY - DEFAULT_SRJ15_BOUNDS_EXPANSION,
    )
    expect(scenario.bounds.maxY).toBe(
      manifestSample.region.maxY + DEFAULT_SRJ15_BOUNDS_EXPANSION,
    )
  }
})

test("srj15 sample obstacles respect the configured minimum obstacle dimension", async () => {
  const srj15Scenarios = await loadScenarios("srj15")

  for (const [, scenario] of srj15Scenarios) {
    for (const obstacle of scenario.obstacles) {
      expect(obstacle.width).toBeGreaterThanOrEqual(
        DEFAULT_SRJ15_MIN_OBSTACLE_DIMENSION,
      )
      expect(obstacle.height).toBeGreaterThanOrEqual(
        DEFAULT_SRJ15_MIN_OBSTACLE_DIMENSION,
      )
    }
  }
})
