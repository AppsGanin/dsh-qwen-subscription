/** Translate OpenAI-compatible chat-completion SSE payloads into StreamChunks. */
import { providerFailure } from './errors.js'

/** Read a counter that may be absent or malformed. */
function countOf(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Split provider token accounting into the harness's disjoint counters.
 * @param usage - the provider `usage` object.
 * @returns a TokenUsage chunk payload.
 */
export function tokenUsageOf(usage) {
  const prompt = countOf(usage.prompt_tokens)
  const cached = countOf(usage.prompt_tokens_details === undefined || usage.prompt_tokens_details === null
    ? undefined
    : usage.prompt_tokens_details.cached_tokens)
  const completion = countOf(usage.completion_tokens)
  const reasoning = countOf(usage.completion_tokens_details === undefined || usage.completion_tokens_details === null
    ? undefined
    : usage.completion_tokens_details.reasoning_tokens)
  const result = { inputTokens: Math.max(0, prompt - cached), outputTokens: completion }
  if (Number.isFinite(usage.total_tokens) && usage.total_tokens > 0) result.totalTokens = Math.round(usage.total_tokens)
  if (cached > 0) result.cacheReadTokens = cached
  if (reasoning > 0) result.reasoningTokens = reasoning
  return result
}

/** Map one provider stop reason onto the harness finish vocabulary. */
export function finishReasonOf(reason) {
  if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' }
  if (reason === 'length') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/**
 * Turn parsed SSE payloads into the adapter chunk protocol: interleaved reasoning,
 * text, and tool-call blocks, then block ends, usage, and the terminal finish.
 * @param payloads - payload strings from the SSE parser.
 * @param context - `model`, plus the HTTP `status`/`headers` that carried the stream.
 * @returns an async generator of StreamChunks.
 */
export async function* translateStream(payloads, context = {}) {
  const blocks = []
  const toolBlocks = new Map()
  let reasoningBlock
  let textBlock
  let usage
  let finishReason
  let responseId

  function startBlock(kind) {
    const block = { index: blocks.length, kind, text: '', id: '', name: '', args: '' }
    blocks.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') break
    let data
    try {
      data = JSON.parse(payload)
    } catch (_partialPayload) {
      continue
    }
    if (data === null || typeof data !== 'object') continue
    if (data.error !== undefined && data.error !== null) {
      // The HTTP exchange succeeded; the refusal lives in the event body, so the
      // envelope's type decides the code rather than the stream's 200 status.
      throw providerFailure(undefined, payload, context.headers, 'Qwen stream error')
    }
    if (data.type === 'subscription_quota' || data.type === 'insufficient_quota') {
      // A quota refusal can arrive as a bare event without an error envelope;
      // treating it as an empty success would hide the exhaustion from the pool.
      throw providerFailure(undefined, payload, context.headers, 'Qwen stream quota refusal')
    }
    if (responseId === undefined && typeof data.id === 'string' && data.id.length > 0) responseId = data.id
    if (data.usage !== undefined && data.usage !== null) usage = data.usage
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined
    if (choice === undefined || choice === null) continue
    const delta = choice.delta === undefined || choice.delta === null ? {} : choice.delta

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      if (reasoningBlock === undefined) {
        reasoningBlock = startBlock('reasoning')
        yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
      }
      reasoningBlock.text += delta.reasoning_content
      yield { type: 'reasoning-delta', index: reasoningBlock.index, text: delta.reasoning_content }
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      if (textBlock === undefined) {
        textBlock = startBlock('text')
        yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
      }
      textBlock.text += delta.content
      yield { type: 'text-delta', index: textBlock.index, text: delta.content }
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        if (call === null || typeof call !== 'object') continue
        const key = Number.isInteger(call.index) ? call.index : 0
        let entry = toolBlocks.get(key)
        const name = call.function !== undefined && call.function !== null && typeof call.function.name === 'string'
          ? call.function.name
          : ''
        if (entry === undefined) {
          entry = startBlock('tool-call')
          entry.id = typeof call.id === 'string' && call.id.length > 0 ? call.id : 'call_' + String(key)
          entry.name = name
          toolBlocks.set(key, entry)
          yield { type: 'block-start', index: entry.index, blockType: 'tool-call' }
        } else {
          if (name.length > 0 && entry.name.length === 0) entry.name = name
          // Some gateways send the call id only in a later delta. The assembler
          // takes the id of the latest delta, so adopting the real one here keeps
          // the tool result correlated with the provider's own call.
          if (typeof call.id === 'string' && call.id.length > 0 && call.id !== entry.id) entry.id = call.id
        }
        const argumentsDelta = call.function !== undefined && call.function !== null && typeof call.function.arguments === 'string'
          ? call.function.arguments
          : ''
        entry.args += argumentsDelta
        yield {
          type: 'tool-call-delta',
          index: entry.index,
          id: entry.id,
          ...(name.length === 0 ? {} : { name }),
          argumentsDelta,
        }
      }
    }

    if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) finishReason = choice.finish_reason
  }

  for (const block of blocks) {
    if (block.kind === 'text') {
      yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
    } else if (block.kind === 'reasoning') {
      yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
    } else {
      yield {
        type: 'block-end',
        index: block.index,
        block: {
          type: 'tool-call',
          id: block.id,
          name: block.name,
          arguments: block.args.length === 0 ? '{}' : block.args,
        },
      }
    }
  }
  if (usage !== undefined) yield { type: 'usage', usage: tokenUsageOf(usage) }
  const replayState = responseId === undefined
    ? undefined
    : { response: { id: responseId, model: context.model, finishReason: finishReason === undefined ? null : finishReason } }
  yield replayState === undefined
    ? { type: 'finish', reason: finishReasonOf(finishReason) }
    : { type: 'finish', reason: finishReasonOf(finishReason), replayState }
}
