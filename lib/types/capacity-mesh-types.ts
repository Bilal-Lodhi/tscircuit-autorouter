export type CapacityMeshNodeId = string

export interface CapacityMesh {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
}

export interface CapacityMeshNode {
  capacityMeshNodeId: string
  center: { x: number; y: number }
  width: number
  height: number
  layer: string
  availableZ: number[]

  _depth?: number

  _completelyInsideObstacle?: boolean
  _containsObstacle?: boolean
  _containsTarget?: boolean
  _targetConnectionName?: string
  _strawNode?: boolean
  _strawParentCapacityMeshNodeId?: CapacityMeshNodeId

  /**
   * Optional override for how much capacity this node can provide. Useful for
   * special cases like off-board assignable obstacles that should only carry a
   * single net.
   */
  _maxCapacityOverride?: number

  /**
   * Off-board connection identifiers for assignable obstacles. Nodes that
   * share an ID are considered electrically connected off-board.
   */
  _offBoardConnectionIds?: string[]

  /**
   * Marks that this node originated from an off-board assignable obstacle,
   * making it traversable even though it overlaps an obstacle shape.
   */
  _isOffBoardAssignableNode?: boolean

  _adjacentNodeIds?: CapacityMeshNodeId[]

  _parent?: CapacityMeshNode
}

export interface CapacityMeshEdge {
  capacityMeshEdgeId: string
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
}
