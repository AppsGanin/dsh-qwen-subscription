/** Build the OpenAI-compatible request body from the harness request vocabulary. */

/** Bytes a request image may occupy before the encoder picks a smaller version. */
export const REQUEST_IMAGE_MAX_BYTES = 4194304

/** Join the text blocks of one message. */
export function textOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Model-visible placeholder for a block this route does not carry natively. */
function placeholderOf(block) {
  const attachment = block.attachment === undefined || block.attachment === null ? {} : block.attachment
  const name = typeof attachment.name === 'string' && attachment.name.length > 0
    ? attachment.name
    : String(attachment.attachmentId)
  if (block.type === 'image') return '[image ' + JSON.stringify(name) + ' could not be attached to this request]'
  if (block.type === 'file') {
    const size = Number.isFinite(attachment.bytes) ? ', ' + String(attachment.bytes) + ' bytes' : ''
    const media = typeof attachment.mediaType === 'string' ? attachment.mediaType : 'file'
    return '[file ' + JSON.stringify(name) + ' (' + media + size + ')]'
  }
  return ''
}

/** Encode one retained image block as a data URL, or undefined when it cannot be read. */
async function imageUrlOf(block, attachments, signal) {
  if (block.offloaded === true) return undefined
  if (attachments === undefined) return undefined
  const ref = block.attachment
  if (ref === undefined || ref === null) return undefined
  try {
    const image = await attachments.readImageRequest(ref, {
      width: ref.width,
      height: ref.height,
      maxBytes: REQUEST_IMAGE_MAX_BYTES,
    }, signal)
    return 'data:' + image.mediaType + ';base64,' + Buffer.from(image.data).toString('base64')
  } catch (error) {
    if (signal !== undefined && signal.aborted) throw error
    return undefined
  }
}

/** Map user content onto the provider's ordered part list. */
async function userContent(content, context) {
  const parts = []
  for (const block of content ?? []) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      const url = await imageUrlOf(block, context.attachments, context.signal)
      if (url !== undefined) {
        parts.push({ type: 'image_url', image_url: { url } })
        continue
      }
    }
    const placeholder = placeholderOf(block)
    if (placeholder.length > 0) parts.push({ type: 'text', text: placeholder })
  }
  if (parts.length === 0) return ''
  if (parts.every((part) => part.type === 'text')) return parts.map((part) => part.text).join('\n')
  return parts
}

/** Map one durable assistant message onto the provider's assistant shape. */
function assistantMessage(message) {
  const toolCalls = []
  const reasoning = []
  for (const block of message.content ?? []) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'tool-call') {
      toolCalls.push({
        id: String(block.id),
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.arguments === 'string' && block.arguments.length > 0 ? block.arguments : '{}',
        },
      })
    } else if (block.type === 'reasoning' && typeof block.text === 'string') {
      reasoning.push(block.text)
    }
  }
  const wire = { role: 'assistant', content: textOf(message.content) }
  if (toolCalls.length > 0) wire.tool_calls = toolCalls
  if (reasoning.length > 0) wire.reasoning_content = reasoning.join('\n')
  return wire
}

/**
 * Project the assembled request onto the provider message list.
 * @param options - the harness request.
 * @param context - attachment store and cancellation for image projection.
 * @returns the provider messages array.
 */
export async function prepareMessages(options, context = {}) {
  const messages = []
  if (typeof options.system === 'string' && options.system.length > 0) {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of options.messages ?? []) {
    if (message === null || typeof message !== 'object') continue
    switch (message.role) {
      case 'system':
        messages.push({ role: 'system', content: textOf(message.content) })
        break
      case 'developer': {
        const text = textOf(message.content)
        if (text.length > 0) messages.push({ role: 'system', content: text })
        break
      }
      case 'user':
        messages.push({ role: 'user', content: await userContent(message.content, context) })
        break
      case 'assistant':
        messages.push(assistantMessage(message))
        break
      case 'tool':
        messages.push({
          role: 'tool',
          tool_call_id: String(message.toolCallId),
          content: textOf(message.content),
        })
        break
      default:
        break
    }
  }
  return messages
}

/** Map declared tools onto the provider's function declarations. */
export function serializeTools(tools) {
  const serialized = []
  for (const tool of tools ?? []) {
    if (tool === null || typeof tool !== 'object') continue
    if (typeof tool.name !== 'string' || tool.name.length === 0) continue
    serialized.push({
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.parameters !== null && typeof tool.parameters === 'object'
          ? tool.parameters
          : { type: 'object', properties: {} },
      },
    })
  }
  return serialized
}

/**
 * Build the JSON body of one streaming chat-completion request.
 * @param options - the harness request.
 * @param messages - provider messages from {@link prepareMessages}.
 * @param config - adapter configuration with an optional default output cap.
 * @returns the request body.
 */
export function buildRequestBody(options, messages, config = {}) {
  const body = { model: options.model, messages, stream: true, stream_options: { include_usage: true } }
  const tools = serializeTools(options.tools)
  if (tools.length > 0) body.tools = tools
  if (Number.isFinite(options.temperature)) body.temperature = options.temperature
  const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : config.defaultMaxTokens
  if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens
  if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
  const effort = options.reasoningEffort
  if (effort === 'off') {
    body.enable_thinking = false
    body.reasoning_effort = 'none'
  } else if (typeof effort === 'string' && effort.length > 0) {
    body.enable_thinking = true
    body.reasoning_effort = effort
  }
  return body
}
