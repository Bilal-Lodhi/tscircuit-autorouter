export type JumperFootprint = "0603" | "1206"

// NOTE: 0805 should be avoided as a jumper because it has a bad ratio of pad
// size to under-body clearance

/**
 * 0603 footprint dimensions in mm
 * 0.8mm x 0.95mm pads, 1.65mm center-to-center
 */
export const JUMPER_0603 = {
  length: 1.65,
  width: 0.95,
  padLength: 0.8,
  padWidth: 0.95,
}

/**
 * 1206 footprint dimensions in mm
 * Actual 1206: 3.2mm x 1.6mm
 */
export const JUMPER_1206 = {
  length: 3.2,
  width: 1.6,
  padLength: 0.6,
  padWidth: 1.6,
}

export const JUMPER_DIMENSIONS: Record<JumperFootprint, typeof JUMPER_0603> = {
  "0603": JUMPER_0603,
  "1206": JUMPER_1206,
}
