import { createOpenAI } from '@ai-sdk/openai';
import { modelFetch } from '../governance/model-transport';

export function modelClient(
  config: {
    apiKey: string;
    baseURL?: string;
    protocol: 'chat' | 'responses';
    provider?: string;
  },
  send: typeof fetch = modelFetch,
) {
  const deepseek =
    config.protocol === 'chat' &&
    (config.provider === 'deepseek' ||
      (config.baseURL &&
        new URL(config.baseURL).hostname === 'api.deepseek.com'));
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fetch: deepseek ? deepseekChat(send) : send,
  });
}

// https://api-docs.deepseek.com/api/create-chat-completion/
// DeepSeek Chat supports JSON object mode. The SDK still parses and validates
// the complete result against its original Output.object schema. Adapt before
// metering so reservation includes the exact schema and prompt sent upstream.
function deepseekChat(send: typeof fetch): typeof fetch {
  return (url, init) => {
    if (
      !(url instanceof Request ? url.url : url.toString()).endsWith(
        '/chat/completions',
      ) ||
      typeof init?.body !== 'string'
    )
      return send(url, init);
    const body = JSON.parse(init.body) as {
      thinking?: { type: string };
      messages: { role: string; content: unknown }[];
      response_format?: { type: string; json_schema?: { schema: unknown } };
    };
    body.thinking = { type: 'disabled' };
    if (body.response_format?.type === 'json_schema') {
      const guidance =
        'Return a JSON object matching this JSON Schema: ' +
        JSON.stringify(body.response_format.json_schema?.schema);
      const system = body.messages.find(
        (m) => m.role === 'system' && typeof m.content === 'string',
      );
      if (system) system.content = String(system.content) + '\n' + guidance;
      else body.messages.unshift({ role: 'system', content: guidance });
      body.response_format = { type: 'json_object' };
    }
    return send(url, { ...init, body: JSON.stringify(body) });
  };
}
