import type { JumperPrepatternSolver } from "../JumperPrepatternSolver"
import type { SimpleRouteJson } from "../../../types"

/**
 * 0603 footprint dimensions in mm
 * 0.8mm x 0.95mm pads, 1.65mm center-to-center
 */
const JUMPER_0603 = {
  length: 1.65,
  width: 0.95,
  padLength: 0.8,
  padWidth: 0.95,
}

/**
 * 1206 footprint dimensions in mm
 * Actual 1206: 3.2mm x 1.6mm
 */
const JUMPER_1206 = {
  length: 3.2,
  width: 1.6,
  padLength: 0.6,
  padWidth: 1.6,
}

type JumperFootprint = "0603" | "1206"

const JUMPER_DIMENSIONS: Record<JumperFootprint, typeof JUMPER_0603> = {
  "0603": JUMPER_0603,
  "1206": JUMPER_1206,
}

/**
 * Default margin between jumpers in mm
 */
const JUMPER_MARGIN = 0.6

export interface Obstacle {
  type: "rect"
  obstacleId: string
  layers: string[]
  center: { x: number; y: number }
  width: number
  height: number
  connectedTo: string[]
  offBoardConnectsTo?: string[]
}

export interface PrepatternJumper {
  jumperId: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  footprint: JumperFootprint
  offBoardConnectionId: string
}

export interface PatternResult {
  jumperPadObstacles: Obstacle[]
  prepatternJumpers: PrepatternJumper[]
}

/**
 * Generates a grid of alternating horizontal and vertical jumpers.
 *
 * Hyperparameters:
 * - FIRST_ORIENTATION: "horizontal" (0) or "vertical" (1) - determines which orientation starts at (0,0)
 */
export function alternatingGrid(jps: JumperPrepatternSolver): PatternResult {
  const prepatternJumpers: PrepatternJumper[] = []
  const jumperPadObstacles: Obstacle[] = []

  const padding = 0.8
  const node = jps.nodeWithPortPoints
  const bounds = {
    minX: node.center.x - node.width / 2 + padding,
    maxX: node.center.x + node.width / 2 - padding,
    minY: node.center.y - node.height / 2 + padding,
    maxY: node.center.y + node.height / 2 - padding,
    width: 0,
    height: 0,
  }
  bounds.width = bounds.maxX - bounds.minX
  bounds.height = bounds.maxY - bounds.minY

  const dims = JUMPER_DIMENSIONS[jps.jumperFootprint]
  const jumperLength = dims.length

  // Get hyperparameters with defaults
  // FIRST_ORIENTATION: 0 = horizontal first, 1 = vertical first
  const firstOrientationVertical =
    jps.hyperParameters.FIRST_ORIENTATION === "vertical"

  // Cell size for the grid - each cell fits one jumper (either orientation)
  // Use the larger dimension plus margin to ensure no overlap
  const cellSize = jumperLength + JUMPER_MARGIN

  const numCols = Math.floor((bounds.maxX - bounds.minX) / cellSize)
  const numRows = Math.floor((bounds.maxY - bounds.minY) / cellSize)

  let jumperIndex = 0

  const gridOffsetX = (bounds.width - numCols * cellSize) / 2
  const gridOffsetY = (bounds.height - numRows * cellSize) / 2

  const createJumperObstacles = (
    jumperId: string,
    start: { x: number; y: number },
    end: { x: number; y: number },
    footprint: JumperFootprint,
    offBoardConnectionId: string,
  ) => {
    const jumperDims = JUMPER_DIMENSIONS[footprint]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const isHorizontal = Math.abs(dx) > Math.abs(dy)

    const padWidth = isHorizontal ? jumperDims.padLength : jumperDims.padWidth
    const padHeight = isHorizontal ? jumperDims.padWidth : jumperDims.padLength

    jumperPadObstacles.push({
      type: "rect",
      obstacleId: `${jumperId}_pad_start`,
      layers: ["top"],
      center: { x: start.x, y: start.y },
      width: padWidth,
      height: padHeight,
      connectedTo: [],
      offBoardConnectsTo: [offBoardConnectionId],
    })

    jumperPadObstacles.push({
      type: "rect",
      obstacleId: `${jumperId}_pad_end`,
      layers: ["top"],
      center: { x: end.x, y: end.y },
      width: padWidth,
      height: padHeight,
      connectedTo: [],
      offBoardConnectsTo: [offBoardConnectionId],
    })
  }

  const jumperOverlapsPortPoint = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): boolean => {
    const margin = dims.width / 2 + jps.traceWidth * 2

    for (const pp of jps.nodeWithPortPoints.portPoints) {
      const distToStart = Math.sqrt(
        (pp.x - start.x) ** 2 + (pp.y - start.y) ** 2,
      )
      if (distToStart < margin) return true

      const distToEnd = Math.sqrt((pp.x - end.x) ** 2 + (pp.y - end.y) ** 2)
      if (distToEnd < margin) return true
    }

    return false
  }

  const addJumper = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) => {
    // Check bounds
    const maxX = Math.max(start.x, end.x)
    const maxY = Math.max(start.y, end.y)

    if (
      start.x < bounds.minX ||
      end.x > bounds.maxX ||
      start.y < bounds.minY ||
      end.y > bounds.maxY ||
      maxX > bounds.maxX ||
      maxY > bounds.maxY
    ) {
      return false
    }

    if (jumperOverlapsPortPoint(start, end)) {
      return false
    }

    const jumperId = `jumper_${jumperIndex}`
    const offBoardConnectionId = `jumper_conn_${jumperIndex}`

    prepatternJumpers.push({
      jumperId,
      start,
      end,
      footprint: jps.jumperFootprint,
      offBoardConnectionId,
    })

    createJumperObstacles(
      jumperId,
      start,
      end,
      jps.jumperFootprint,
      offBoardConnectionId,
    )

    jumperIndex++
    return true
  }

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      // Center of this grid cell
      const cellCenterX =
        bounds.minX + cellSize / 2 + col * cellSize + gridOffsetX
      const cellCenterY =
        bounds.minY + cellSize / 2 + row * cellSize + gridOffsetY

      // Alternate orientation based on checkerboard pattern
      // XOR with firstOrientationVertical to flip the pattern if needed
      const baseIsVertical = (row + col) % 2 === 1
      const isVertical = firstOrientationVertical
        ? !baseIsVertical
        : baseIsVertical

      let start: { x: number; y: number }
      let end: { x: number; y: number }

      if (isVertical) {
        // Vertical jumper (90°)
        start = { x: cellCenterX, y: cellCenterY - jumperLength / 2 }
        end = { x: cellCenterX, y: cellCenterY + jumperLength / 2 }
      } else {
        // Horizontal jumper (0°)
        start = { x: cellCenterX - jumperLength / 2, y: cellCenterY }
        end = { x: cellCenterX + jumperLength / 2, y: cellCenterY }
      }

      addJumper(start, end)
    }
  }

  return { jumperPadObstacles, prepatternJumpers }
}
