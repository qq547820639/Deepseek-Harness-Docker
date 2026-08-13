// 端到端验证用 mock LLM：OpenAI 兼容端点（非流式 + SSE 流式）。
// 第一轮返回 bash 工具调用（echo sandbox-ok）；收到工具结果后返回最终文本。
// 用途：不依赖真实 API Key，完整验证「模型调用 → agent 工具执行 → 沙箱 → 结果回传」链路。
// 用法: node mock-llm.mjs [port]   (默认 18765)
import http from 'node:http'

const PORT = Number(process.argv[2] ?? 18765)
const MODEL = 'mock-chat'

function chunk(choices, finish = null) {
  return { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model: MODEL, choices }
}

function sse(res, payload, done = false) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
  if (done) res.write('data: [DONE]\n\n')
}

function toolCallPlan() {
  const args = JSON.stringify({ command: 'echo sandbox-ok', description: 'verify sandbox execution' })
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_mock_1', type: 'function', function: { name: 'bash', arguments: args } }],
  }
}

function handleChat(req, res, body) {
  const messages = body.messages ?? []
  const toolResult = messages.find((m) => m.role === 'tool')
  const stream = body.stream === true

  if (!toolResult && messages.filter((m) => m.role === 'assistant').length > 4) {
    // 安全网：多轮仍未出现工具结果则直接收尾
    const text = 'mock final: no tool result received, giving up'
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      sse(res, chunk([{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]))
      sse(res, chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]), true)
      res.end()
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', created: 0, model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }))
    }
    return
  }

  if (!toolResult) {
    // 第一轮：要求执行 bash 工具
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const call = toolCallPlan()
      sse(res, chunk([{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }]))
      sse(res, chunk([{ index: 0, delta: { tool_calls: [{ index: 0, id: call.tool_calls[0].id, type: 'function',
        function: { name: 'bash', arguments: call.tool_calls[0].function.arguments } }] }, finish_reason: null }]))
      sse(res, chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]), true)
      res.end()
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', created: 0, model: MODEL,
        choices: [{ index: 0, message: toolCallPlan(), finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }))
    }
    return
  }

  // 第二轮：报告工具结果
  const output = String(toolResult.content ?? '')
  const text = `agent-verified: tool executed, output=${JSON.stringify(output.trim())}`
  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    sse(res, chunk([{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]))
    sse(res, chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]), true)
    res.end()
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', created: 0, model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }))
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/v1/models' || req.url === '/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'mock' }] }))
    return
  }
  if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try {
        handleChat(req, res, JSON.parse(raw || '{}'))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: String(err) } }))
      }
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock: no route ${req.method} ${req.url}` } }))
})

server.listen(PORT, '0.0.0.0', () => console.log(`mock-llm listening on 0.0.0.0:${PORT}`))
