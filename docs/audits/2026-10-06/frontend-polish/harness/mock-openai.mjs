// Local OpenAI Responses-API mock for UI verification only. Not a real provider.
// Behaviour is chosen from the last user message:
//   含「失败」 → HTTP 500 every time
//   含「一次失败」 → the first turn fails, a retried turn succeeds. The OpenAI
//                   SDK retries 5xx twice by itself, so one turn = 3 calls.
//   含「长」   → long markdown with code block + table, streamed slowly
//   含「慢」   → very slow stream (cancel path)
//   otherwise → short markdown reply
import http from 'node:http';

const port = Number(process.env.MOCK_PORT ?? 56400);
const failedCalls = new Map();

function lastUserText(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (item.role !== 'user') continue;
    if (typeof item.content === 'string') return item.content;
    if (Array.isArray(item.content)) {
      return item.content.map((part) => part.text ?? '').join('');
    }
  }
  return '';
}

const LONG = `这里是本周跟进情况的汇总。

## 重点客户

| 客户 | 阶段 | 下一步 |
| --- | --- | --- |
| 华东物流 | 方案评估 | 周四前发送报价 |
| 南方医疗器械 | 商务谈判 | 约采购负责人复盘 |
| 星河教育 | 初步接触 | 补充需求调研 |

## 建议

1. 优先处理 **已逾期** 的 3 条跟进，其中 2 条属于华东物流。
2. 南方医疗器械的合同金额较大，建议今天安排一次电话确认。
3. 星河教育目前信息不足，可以先补齐联系人和预算字段。

如果需要导出，可以用下面的筛选条件：

\`\`\`json
{
  "stage": ["proposal", "negotiation"],
  "owner": "me",
  "dueBefore": "2026-10-09T23:59:59+08:00",
  "includeOverdue": true,
  "veryLongFieldNameToCheckHorizontalScrollingInsideCodeBlocks": "this-line-is-intentionally-long-to-verify-that-the-code-block-scrolls-instead-of-overflowing-the-message"
}
\`\`\`

另外，行内代码如 \`followUp.dueAt\` 也应清晰可读。整体来看，本周有 **12** 条进行中的商机，比上周多 2 条。`;

const SHORT = `可以。根据你当前可见的数据，**今天到期的跟进有 2 条**：

- 华东物流：确认报价单
- 星河教育：补充需求调研

需要我帮你起草跟进记录吗？`;

function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/responses')) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw || '{}');
  const text = lastUserText(body);
  console.log(new Date().toISOString(), 'request', JSON.stringify(text.slice(0, 40)));

  if (text.includes('一次失败') && (failedCalls.get(text) ?? 0) < 3) {
    failedCalls.set(text, (failedCalls.get(text) ?? 0) + 1);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock failure', type: 'server_error' } }));
    return;
  }
  if (text.includes('失败') && !text.includes('一次失败')) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock failure', type: 'server_error' } }));
    return;
  }

  const reply = text.includes('长') || text.includes('慢') ? LONG : SHORT;
  const delay = text.includes('慢') ? 400 : text.includes('长') ? 60 : 30;
  let closed = false;
  req.on('close', () => { closed = true; });
  res.on('close', () => { closed = true; });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const id = `resp_${Date.now()}`;
  const itemId = `msg_${Date.now()}`;
  send({ type: 'response.created', response: { id, created_at: Math.floor(Date.now() / 1000), model: body.model ?? 'mock' } });
  send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: itemId } });
  for (const delta of chunks(reply, 6)) {
    if (closed) { console.log('client closed stream'); return; }
    send({ type: 'response.output_text.delta', item_id: itemId, output_index: 0, delta });
    await sleep(delay);
  }
  send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: itemId } });
  send({ type: 'response.completed', response: { usage: { input_tokens: 120, output_tokens: reply.length } } });
  res.end('data: [DONE]\n\n');
});

server.listen(port, '127.0.0.1', () => console.log(`mock openai on ${port}`));
