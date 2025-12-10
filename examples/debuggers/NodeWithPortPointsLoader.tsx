import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

interface NodeWithPortPointsLoaderProps {
  title: string
  description?: string
  renderDebugger: (node: NodeWithPortPoints) => ReactNode
}

const tryParse = (raw: string): NodeWithPortPoints | null => {
  const parsed = JSON.parse(raw) as NodeWithPortPoints
  if (!parsed || typeof parsed !== "object") {
    return null
  }

  return parsed
}

const parseNodeWithPortPoints = (
  raw: string | null,
): { node: NodeWithPortPoints | null; error?: string } => {
  if (!raw) return { node: null }

  const attempts: string[] = [raw]

  try {
    const decoded = decodeURIComponent(raw)
    if (decoded !== raw) {
      attempts.push(decoded)
      const doubleDecoded = decodeURIComponent(decoded)
      if (doubleDecoded !== decoded) attempts.push(doubleDecoded)
    }
  } catch {
    // ignore decode errors, we'll fall back to the raw value
  }

  for (const attempt of attempts) {
    try {
      const parsed = tryParse(attempt)
      if (parsed) return { node: parsed }
    } catch (error) {
      // Keep trying other candidates
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === attempts[attempts.length - 1]) {
        return {
          node: null,
          error: `Failed to parse NodeWithPortPoints: ${message}`,
        }
      }
    }
  }

  return {
    node: null,
    error:
      "Failed to parse NodeWithPortPoints: Provided data is not a valid object.",
  }
}

const persistNodeToUrl = (value: string | null) => {
  const url = new URL(window.location.href)
  if (value) {
    url.searchParams.set("nodeWithPortPoints", value)
  } else {
    url.searchParams.delete("nodeWithPortPoints")
  }
  window.history.replaceState(null, "", url.toString())
}

export const NodeWithPortPointsLoader = ({
  title,
  description,
  renderDebugger,
}: NodeWithPortPointsLoaderProps) => {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialRaw = params.get("nodeWithPortPoints")
  const initialParse = useMemo(
    () => parseNodeWithPortPoints(initialRaw),
    [initialRaw],
  )

  const [inputValue, setInputValue] = useState(
    initialParse.node
      ? JSON.stringify(initialParse.node, null, 2)
      : (initialRaw ?? ""),
  )
  const [node, setNode] = useState<NodeWithPortPoints | null>(initialParse.node)
  const [error, setError] = useState<string | undefined>(initialParse.error)

  const handleLoad = () => {
    const parsed = parseNodeWithPortPoints(inputValue)

    setNode(parsed.node)
    setError(parsed.error)

    if (parsed.node) {
      const serialized = JSON.stringify(parsed.node)
      persistNodeToUrl(serialized)
      setInputValue(JSON.stringify(parsed.node, null, 2))
    }
  }

  const handleReset = () => {
    setNode(null)
    setError(undefined)
    setInputValue("")
    persistNodeToUrl(null)
  }

  if (node) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <button
            className="rounded bg-blue-500 px-3 py-1 text-white hover:bg-blue-600"
            onClick={handleReset}
          >
            Load different data
          </button>
        </div>
        {renderDebugger(node)}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-gray-700">{description}</p> : null}
      </div>
      {error ? <div className="text-red-600">{error}</div> : null}
      <label className="block text-sm font-medium text-gray-700">
        NodeWithPortPoints JSON
      </label>
      <textarea
        className="h-80 w-full rounded border border-gray-300 p-3 font-mono text-sm"
        placeholder="Paste NodeWithPortPoints JSON here..."
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
      />
      <div>
        <button
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          onClick={handleLoad}
        >
          Load Debugger
        </button>
      </div>
    </div>
  )
}
