import type { Connection, Model, Purpose } from "./model-data";

export function modelEntry(
  name = "",
  capabilities: Purpose[] = [],
  contextTokens: number | null = null,
  maxOutputTokens: number | null = null,
): Model {
  return {
    name,
    capabilities,
    contextTokens,
    maxOutputTokens,
    inputPrice: null,
    outputPrice: null,
    currency: null,
  };
}
const multimodal = (name: string, context: number, output: number | null) =>
  modelEntry(name, ["text", "vision"], context, output);
const embeddings = (name: string, context: number) =>
  modelEntry(name, ["embedding"], context);
export const presets: Connection[] = [
  {
    preset: "deepseek",
    name: "DeepSeek 官方",
    baseURL: "https://api.deepseek.com",
    protocol: "responses",
    embeddings: false,
    models: [multimodal("deepseek-flash", 1000000, 384000)],
  },
  {
    preset: "bailian",
    name: "阿里云百炼",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "chat",
    embeddings: true,
    models: [
      multimodal("qwen3-vl-plus", 262144, 32768),
      embeddings("text-embedding-v4", 8192),
    ],
  },
  {
    preset: "ark",
    name: "火山方舟",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "chat",
    embeddings: false,
    models: [multimodal("doubao-seed-2-1-pro-260915", 1048576, 262144)],
  },
  {
    preset: "zhipu",
    name: "智谱",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "chat",
    embeddings: false,
    models: [multimodal("glm-4.6v", 128000, null)],
  },
  {
    preset: "kimi",
    name: "Kimi",
    baseURL: "https://api.moonshot.cn/v1",
    protocol: "chat",
    embeddings: false,
    models: [multimodal("kimi-k3.1-pro", 1000000, null)],
  },
  {
    preset: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    protocol: "responses",
    embeddings: true,
    models: [
      multimodal("gpt-5-mini", 400000, 128000),
      embeddings("text-embedding-3-small", 8191),
    ],
  },
  {
    preset: "custom",
    name: "自定义 OpenAI 兼容",
    baseURL: "",
    protocol: "chat",
    embeddings: false,
    models: [],
  },
];
