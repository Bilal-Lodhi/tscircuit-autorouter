export type Point3 = { x: number; y: number; z: number }

export type Segment = {
  connectionName: string
  start: Point3
  end: Point3
}

export type PortPointCollection = {
  connectionName: string
  points: Point3[]
}
