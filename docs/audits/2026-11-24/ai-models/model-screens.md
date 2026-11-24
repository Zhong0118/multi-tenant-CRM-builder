# 平台模型配置页面验收

使用本地 Next.js 平台页面与独立模拟 API。截图内的名称、配置、延迟和向量维度都是界面夹具。Key 输入截图使用空字段，连接信息仅显示遮盖符。测试界面中的输出上限由模拟管理员填写。

| 页面与状态 | 1440 × 900 | 1280 × 900 |
| --- | --- | --- |
| 三种用途均已有分配 | [1440](model-settings-1440.png) | [1280](model-settings-1280.png) |
| 仅环境变量有文字模型 | [1440](environment-1440.png) | [1280](environment-1280.png) |
| 新 Key 测试失败，旧分配仍在使用 | [1440](failed-edit-1440.png) | [1280](failed-edit-1280.png) |
| 展开模型选项，显示无法分配的原因 | [1440](model-choices-1440.png) | [1280](model-choices-1280.png) |
| 更换文字模型并确认影响 | [1440](model-switch-1440.png) | [1280](model-switch-1280.png) |
| 添加供应商，选择预设 | [1440](provider-preset-1440.png) | [1280](provider-preset-1280.png) |
| Kimi 中国站及高级连接设置 | [1440](provider-connection-1440.png) | [1280](provider-connection-1280.png) |
| 添加供应商，逐项测试通过后保存 | [1440](provider-test-1440.png) | [1280](provider-test-1280.png) |
| 编辑套餐，按组列出八项，销售日常三项禁选 | [1440](plan-editor-1440.png) | [1280](plan-editor-1280.png) |

在浏览器中逐项操作并读取页面尺寸，上述页面的文档宽度均等于视口宽度。用于截图的固定输出响应只验证页面交互和排版。真实厂商测试另见阶段 A 验收记录。

## 预设核对

| 供应商 | 依据 |
| --- | --- |
| DeepSeek | [官方模型能力和兼容地址](https://api-docs.deepseek.com/quick_start/pricing/) |
| 阿里云百炼 | [北京公共地址及专属地址](https://help.aliyun.com/zh/model-studio/base-url) · [视觉模型](https://help.aliyun.com/zh/model-studio/qwen3-vl-plus) · [向量模型及地域](https://www.alibabacloud.com/help/en/model-studio/embedding-interfaces-compatible-with-openai) |
| 火山方舟 | [官方模型列表](https://console.volcengine.com/ark/region%3Acn-beijing/docs/model-list) |
| 智谱 | [GLM-4.6V 官方模型说明](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v) |
| Kimi | [中国站接入地址](https://platform.kimi.com/blog/posts/kimi-api-quick-start-guide) · [中国站模型列表](https://platform.kimi.com/docs/models) · [国际站接入地址](https://platform.kimi.ai/docs/get-your-api-key) |
| OpenAI | [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini) · [向量接口](https://developers.openai.com/api/reference/resources/embeddings/methods/create) |
