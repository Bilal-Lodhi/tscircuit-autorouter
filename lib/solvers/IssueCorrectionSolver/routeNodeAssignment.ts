import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { getNodeBounds } from "./geometry"

const isPointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
  margin = 0,
) => {
  const bounds = getNodeBounds(node, margin)
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

const getRouteNodeConnectionMatchScore = (
  route: HighDensityRoute,
  node: NodeWithPortPoints,
) => {
  let score = 0

  for (const portPoint of node.portPoints) {
    if (portPoint.connectionName === route.connectionName) {
      score += 3
    }
    if (
      route.rootConnectionName &&
      portPoint.rootConnectionName === route.rootConnectionName
    ) {
      score += 2
    }
    if (
      route.rootConnectionName &&
      portPoint.connectionName === route.rootConnectionName
    ) {
      score += 1
    }
  }

  return score
}

export const findNodeIndexForRoute = (
  route: HighDensityRoute,
  nodes: NodeWithPortPoints[],
  margin: number,
) => {
  const routePoints = route.route.map(({ x, y }) => ({ x, y }))
  const viaPoints = route.vias.map(({ x, y }) => ({ x, y }))
  const points = [...routePoints, ...viaPoints]
  let bestNodeIndex = -1
  let bestMatchScore = -1
  let bestArea = Number.POSITIVE_INFINITY

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!points.every((point) => isPointInsideNode(point, node, margin))) {
      continue
    }

    const matchScore = getRouteNodeConnectionMatchScore(route, node)
    const area = node.width * node.height

    if (
      matchScore > bestMatchScore ||
      (matchScore === bestMatchScore && area < bestArea)
    ) {
      bestNodeIndex = i
      bestMatchScore = matchScore
      bestArea = area
    }
  }

  return bestNodeIndex
}

export const buildRouteNodeAssignment = (
  routes: HighDensityRoute[],
  nodes: NodeWithPortPoints[],
  margin: number,
) => {
  const nodeIndexByRoute = new Map<number, number>()
  const routeIndexesByNode = new Map<number, number[]>()

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const nodeIndex = findNodeIndexForRoute(routes[routeIndex], nodes, margin)
    if (nodeIndex === -1) continue
    nodeIndexByRoute.set(routeIndex, nodeIndex)
    const routeIndexes = routeIndexesByNode.get(nodeIndex) ?? []
    routeIndexes.push(routeIndex)
    routeIndexesByNode.set(nodeIndex, routeIndexes)
  }

  return {
    nodeIndexByRoute,
    routeIndexesByNode,
  }
}

export const findNodeIndexContainingPoint = (
  point: { x: number; y: number },
  nodes: NodeWithPortPoints[],
  margin: number,
) => {
  let bestNodeIndex = -1
  let bestArea = Number.POSITIVE_INFINITY

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (!isPointInsideNode(point, node, margin)) continue
    const area = node.width * node.height
    if (area < bestArea) {
      bestNodeIndex = i
      bestArea = area
    }
  }

  return bestNodeIndex
}
