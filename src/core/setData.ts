type Fetcher = (input: RequestInfo | URL) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseSetPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data
  throw new Error('Invalid set data payload.')
}

export async function fetchSetPayload(fetcher: Fetcher, url: string): Promise<unknown[]> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Failed to fetch set data from ${url}.`)
  return parseSetPayload(await response.json())
}
