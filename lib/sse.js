/** Incremental parser for the provider SSE body: yields one payload per event. */

/** Join the `data:` lines of one raw event block. */
function dataOf(raw) {
  const parts = []
  for (const line of raw.split('\n')) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized.startsWith('data:')) parts.push(normalized.slice(5).trimStart())
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/**
 * Yield event payloads from one SSE response body.
 * @param body - async iterable of byte chunks.
 * @returns an async generator of payload strings, including a final `[DONE]`.
 */
export async function* parseSseData(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/gu, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const payload = dataOf(raw)
      if (payload !== undefined) yield payload
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer = (buffer + decoder.decode()).replace(/\r\n/gu, '\n')
  if (buffer.trim().length > 0) {
    const payload = dataOf(buffer)
    if (payload !== undefined) yield payload
  }
}
