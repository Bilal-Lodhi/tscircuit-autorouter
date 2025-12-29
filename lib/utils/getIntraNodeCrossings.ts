import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { NodeWithPortPoints } from "lib/types/high-density-types"

type NodeSide = "left" | "right" | "top" | "bottom"

// Intersection calculation is only accurate to 0.00001 (0.01mm)
const intSpace = (a: number) => Math.round(a * 10000)

type PointPair = {
  points: { x: number; y: number; z: number }[]
  z: number
  connectionName: string
}

const toIntSpacePoint = (point: { x: number; y: number }) => ({
  x: intSpace(point.x),
  y: intSpace(point.y),
})

const getNodeBounds = (node: NodeWithPortPoints) => ({
  left: node.center.x - node.width / 2,
  right: node.center.x + node.width / 2,
  bottom: node.center.y - node.height / 2,
  top: node.center.y + node.height / 2,
})

const getPointSide = (
  point: { x: number; y: number },
  bounds: ReturnType<typeof getNodeBounds>,
): NodeSide | null => {
  if (point.x === bounds.left) return "left"
  if (point.x === bounds.right) return "right"
  if (point.y === bounds.top) return "top"
  if (point.y === bounds.bottom) return "bottom"
  return null
}

export const getIntraNodeCrossings = (node: NodeWithPortPoints) => {
  // Count the number of crossings
  let numSameLayerCrossings = 0
  const bounds = getNodeBounds(node)
  let pointPairs: PointPair[] = []

  const transitionPairPoints: {
    points: { x: number; y: number; z: number }[]
    connectionName: string
  }[] = []

  for (const A of node.portPoints) {
    if (pointPairs.some((p) => p.connectionName === A.connectionName)) {
      continue
    }
    if (
      transitionPairPoints.some((p) => p.connectionName === A.connectionName)
    ) {
      continue
    }
    const pointPair: PointPair = {
      connectionName: A.connectionName,
      z: A.z,
      points: [{ x: A.x, y: A.y, z: A.z }],
    }
    for (const B of node.portPoints) {
      if (A.connectionName !== B.connectionName) continue
      if (A.x === B.x && A.y === B.y) continue
      pointPair.points.push({ x: B.x, y: B.y, z: B.z })
    }
    if (pointPair.points.some((p) => p.z !== pointPair.z)) {
      transitionPairPoints.push(pointPair)
      continue
    }
    pointPairs.push(pointPair)
  }

  // TODO maybe these should be returned as "number of non-crossing connections"
  pointPairs = pointPairs.filter((p) => p.points.length > 1)

  const collinearConnectionIntersections: Record<string, boolean> = {}
  const allSegments = [
    ...pointPairs.map((pair) => ({
      connectionName: pair.connectionName,
      points: pair.points,
    })),
    ...transitionPairPoints.map((pair) => ({
      connectionName: pair.connectionName,
      points: pair.points,
    })),
  ]
  for (const pair of pointPairs) {
    if (pair.points.length < 2) continue
    if (pair.points.length > 2)
      console.log("larger than 2 will not handel this properly")
    const sideA = getPointSide(pair.points[0], bounds)
    const sideB = getPointSide(pair.points[1], bounds)
    const isCollinear = Boolean(sideA && sideB && sideA === sideB)
    if (!isCollinear) continue
    collinearConnectionIntersections[pair.connectionName] = false
    for (const other of allSegments) {
      if (other.connectionName === pair.connectionName) continue
      if (other.points.length < 2) continue
      if (
        doSegmentsIntersect(
          toIntSpacePoint(pair.points[0]),
          toIntSpacePoint(pair.points[1]),
          toIntSpacePoint(other.points[0]),
          toIntSpacePoint(other.points[1]),
        )
      ) {
        collinearConnectionIntersections[pair.connectionName] = true
        break
      }
    }
  }

  for (let i = 0; i < pointPairs.length; i++) {
    for (let j = i + 1; j < pointPairs.length; j++) {
      const pair1 = pointPairs[i]
      const pair2 = pointPairs[j]
      if (
        pair1.z === pair2.z &&
        doSegmentsIntersect(
          toIntSpacePoint(pair1.points[0]),
          toIntSpacePoint(pair1.points[1]),
          toIntSpacePoint(pair2.points[0]),
          toIntSpacePoint(pair2.points[1]),
        )
      ) {
        numSameLayerCrossings++
      }
    }
  }

  let numTransitionPairCrossings = 0
  for (let i = 0; i < transitionPairPoints.length; i++) {
    for (let j = i + 1; j < transitionPairPoints.length; j++) {
      const pair1 = transitionPairPoints[i]
      const pair2 = transitionPairPoints[j]

      if (
        doSegmentsIntersect(
          toIntSpacePoint(pair1.points[0]),
          toIntSpacePoint(pair1.points[1]),
          toIntSpacePoint(pair2.points[0]),
          toIntSpacePoint(pair2.points[1]),
        )
      ) {
        numTransitionPairCrossings++
      }
    }
  }

  const numCollinearConnectionIntersectionsTrue = Object.values(
    collinearConnectionIntersections,
  ).filter((value) => value).length

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges: transitionPairPoints.length,
    numTransitionPairCrossings,
    numCollinearConnectionIntersections:
      numCollinearConnectionIntersectionsTrue,
  }
}
