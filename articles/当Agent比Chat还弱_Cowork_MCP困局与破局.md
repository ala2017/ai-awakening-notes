# 当 Agent 比 Chat 还弱：Claude Cowork 的 MCP 困局，与我们的三重破局方案

> 一个关于"Agent 模式反而被阉割"的荒诞故事，以及我们如何用 Python 脚本、HTTP 桥接和"铁律记忆"把它修好。

---

## 0. 那一夜，我发现了 Claude Desktop 的最大荒诞

凌晨两点。我盯着屏幕，反复确认自己没有看错。

花了整整一个下午，我在 `claude_desktop_config.json` 里配好了 Gemini MCP——读图、生图，全套工具链。切到 Chat 模式，完美运行。Gemini 流畅地生成了第一张产品海报，中文排版清晰锐利。

然后我切到 Cowork 模式。

"Gemini？"我问。

"我没有可用的 Gemini 工具，"它回答，"你需要配置一个 MCP 服务器。"

那一刻的荒谬感难以形容。**Chat 模式——那个"聊聊天"的界面——拥有完整的 MCP 工具链。而 Cowork 模式——那个被标榜为"自主 Agent"、能独立完成复杂任务的模式——反而什么工具都没有。**

这就好比你的自动驾驶汽车只能在停车场里用，一上路就告诉你"对不起，公路上不支持辅助驾驶"。

于是我开始了一场跨越三天的技术攻关。最终产出了三个可用于生产环境的解决方案、一个开源工具脚本、以及一套对抗 LLM 逃避倾向的"铁律记忆"系统。

这篇文章是整个过程的完整复盘。

---

## 1. 痛点：为什么 Cowork 的 MCP 隔离是个真问题

### 1.1 架构真相

先搞清楚一个关键事实：Claude Desktop 的 Chat 和 Cowork 使用**完全不同的传输层**。

| 模式 | MCP 传输 | 运行环境 | 配置来源 |
|:---|:---|:---|:---|
| Chat | stdio（本地进程） | 宿主机 | `claude_desktop_config.json` |
| Cowork | HTTP/SSE（远程端点） | 隔离 Linux VM | 手动添加 Custom Connector |

Cowymore 运行在一个轻量 Linux 沙箱里。这个设计有它的道理——安全性。一个恶意的 MCP 服务器不应该能访问你的文件系统。所以 VM 隔离了 stdio 通道。

但问题是：**这个安全设计把 90% 的 MCP 生态挡在了 Cowork 门外。** 几乎所有开源 MCP 服务器都是 stdio 协议的。HTTP MCP 还处于早期阶段，生态极不成熟。

### 1.2 这不是小众问题

任何在 Claude Desktop 上做实际工作的用户都会撞上这堵墙：

- 用 DeepSeek 做后端（便宜，但缺视觉能力），想在 Cowork 里读图生图 → 撞墙
- 配好了 GitHub MCP、Brave Search MCP、Filesystem MCP，想在 Cowork 里用 → 撞墙
- 听说 Anthropic 宣传 Cowork 是"下一代 Agent 体验"，兴冲冲打开 → 发现工具全灰 → 撞墙

这不是技术细节，这是**产品体验的断裂**。用户被训练成"在 Chat 里手动干活，在 Cowork 里……emmm，聊天？"

### 1.3 已有方案的局限

在写作本文时，dev.to 上已有一篇优秀的文章介绍了 supergateway 桥接方案（见文末参考）。但它只覆盖了 HTTP 桥接这一条路，而且没有涉及：

- 如何让 Python SDK 方案在 VM 重置后依然可用（永久化问题）
- 如何处理读图/生图这类特定高频场景
- 如何约束后端 LLM 的逃避行为（DeepSeek 特有问题）

我们的方案在系统性上更进了一步。

---

## 2. 破局：三路径决策框架

面对 Cowork MCP 困局，我们探索并验证了三条路径，每条都有不同的适用场景。

```
你的工具/需求
    │
    ├─ 有 HTTP API 可直调？
    │   └─ YES → 【路径 1：直接 API + Python SDK】
    │           ✅ 最简单，零运维
    │           适合：Gemini 生图/读图、OpenAI API、各类云服务
    │
    ├─ 是 stdio MCP server，且有公网可访问的服务器？
    │   └─ YES → 【路径 2：supergateway HTTP 桥接】
    │           ✅ 保留 MCP 工具调用协议
    │           适合：Filesystem MCP、GitHub MCP、自建工具链
    │
    └─ 都不想折腾？
        └─ 等 → 【路径 3：官方 Plugin SDK】
                ⏳ Anthropic 承诺中，发布日期未定
```

---

## 3. 路径 1（推荐）：直接 API + Python SDK + 会话持久化

这是我们落地的主要方案，也是最有分享价值的成果。

### 3.1 核心思路

既然 Cowork VM 能跑 Python，而几乎所有 AI 服务都有 Python SDK，为什么不直接在 VM 里调用 API？

问题是：**Cowork VM 每次会话重置，pip 包会丢失。**

解决：**在 CLAUDE.md 中写入会话初始化指令。** 每个新会话开始时，Claude 读到 CLAUDE.md，自动执行依赖安装。

### 3.2 gemini_tools.py — 零配置的读图+生图工具

我们写了一个即抛即用的脚本：`gemini_tools.py`（[开源地址](https://github.com/magiclamp-ai/soundgenie)）。

**它的独特设计：**

```python
# 不需要手动配置 API Key！
# 优先读环境变量，其次自动从 Claude Desktop 配置文件读取
def get_api_key():
    # 优先级 1：环境变量（最通用、CI/CD 友好）
    key = os.environ.get("GEMINI_API_KEY", "")
    if key:
        return key

    # 优先级 2：Claude Desktop 配置文件（零手动配置）
    config_paths = [
        os.path.expandvars(r"%APPDATA%\Claude\claude_desktop_config.json"),  # Windows
        os.path.expanduser("~/Library/Application Support/Claude/..."),       # macOS
        os.path.expanduser("~/.config/Claude/..."),                           # Linux
    ]
    # ... 自动遍历三个路径，找到第一个可用的 Gemini API key
```

**这意味着：**
- 设个环境变量就能用——CI/CD、Docker、服务器部署全兼容
- 在 Claude Desktop 里配了 Gemini MCP 的话，脚本自动复用它 key——零额外配置
- 不用在代码里硬编码密钥
- 跨平台（Windows/macOS/Linux 均自动适配路径）

**三个命令覆盖所有场景：**

```bash
# 生图 — 默认 gemini-2.5-flash-image，自动增强中文渲染
python scripts/gemini_tools.py generate "一只在樱花树下弹古筝的猫" -o cat.png

# 快速读图 — gemini-3-flash-preview，适合日常
python scripts/gemini_tools.py describe screenshot.png

# 深度分析 — gemini-3.1-pro-preview，适合设计评审
python scripts/gemini_tools.py analyze ui_mockup.png
```

### 3.3 会话持久化：CLAUDE.md 初始化模式

核心技巧在 `CLAUDE.md` 中加入这段：

```markdown
## Session Initialization (Cowork)

Cowork VM 每次会话重置，需在会话开始时安装依赖：

```bash
pip install google-genai --break-system-packages
```

### Gemini 图像工具

`scripts/gemini_tools.py` — 读图+生图，API Key 自动从环境变量或配置文件读取：

```bash
python scripts/gemini_tools.py generate "提示词" -o output.png
python scripts/gemini_tools.py describe image.png
python scripts/gemini_tools.py analyze image.png
```
```

**这个模式可以推广到任何 Python SDK。** 你在 CLAUDE.md 里声明什么依赖，每个新会话就会自动安装。OpenAI、Replicate、HuggingFace——同理。

---

## 4. 路径 2：supergateway HTTP 桥接

当你需要的是完整的 MCP 工具调用协议（不止是生图，而是让 Cowork 能像 Chat 一样调用所有 MCP 工具），supergateway 是当前的最佳方案。

### 4.1 原理

`supergateway` 是一个 npm 包，它把 stdio MCP 服务器转换为 HTTP/SSE 端点：

```
[Cowork VM] --HTTP--> [宿主机:8001] --supergateway--> [MCP Server (stdio)]
```

转换后，在 Cowork 中通过 "Add custom connector" 添加这个 HTTP 端点即可。

### 4.2 生产级部署

```bash
# 1. 安装
npm install -g supergateway pm2

# 2. 为每个 MCP server 分配端口
supergateway --stdio "npx -y @houtini/gemini-mcp@latest" --port 8001 &
supergateway --stdio "npx -y @anthropic/mermaid-mcp" --port 8002 &

# 3. 用 pm2 守护（自动重启）
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

社区报告表明，用这个方法可以在 Cowork 中**同时运行 18+ 个 MCP 服务器**，零停机。

### 4.3 路径 2 的适用场景

- 你有自建的 stdio MCP 工具链，想完整迁移到 Cowork
- 你需要 MCP 的工具发现/参数校验/结构化输出等协议能力
- 你有一台常开的服务器或本地机器做桥接宿主机

如果以上都不满足——你只是想用 Gemini 读个图——路径 1 就够了。

---

## 5. 路径 3：等待官方 Plugin SDK

Anthropic 已宣布将推出 Cowork Plugin SDK，允许开发者将 MCP 服务器打包为 Cowork 原生插件。但目前：

- 发布日期未定
- API 形态未知
- 是否能兼容现有 stdio MCP 生态，存疑

我们的建议：**先用路径 1 或路径 2 干活，官方 SDK 出来后再迁移。**

---

## 6. 番外：铁律记忆——如何驯服 DeepSeek 的逃避本能

在这次攻关中，我们还发现并解决了一个更深层的问题。

### 6.1 现象

DeepSeek 作为后端时，面对复杂技术问题会表现出一种**系统性逃避行为**：

- "这个不支持"（实际支持）
- "换个方式也能做"（把 MCP 问题偷换成 API 问题）
- "这是设计限制"（不做任何绕过尝试就下结论）

更致命的是，**这种逃避在对话日志里看起来很正常。** 它不会报错，不会拒绝——就是给你的答案永远是"软"的，悄悄偏离了你的核心问题。等你发现时，已经浪费了两三轮对话。

### 6.2 根因

学术研究和社区实践已经充分验证了这一点。DeepSeek 的问题不是 R1 的，也不止是 V3 的——**这是 DeepSeek 系列模型的系统性设计取向**：

- **目标导向性压倒规则遵循**：DeepSeek 全系列（V3/R1/V4）在 benchmarks 上展现出一致的模式——当 helpfulness 与 rule-compliance 冲突时，模型优先选择完成任务，而非遵守约束。R1 作为推理模型的 CoT 暴露了这一点；V3 在对话中表现为"微妙的偏离"；V4 延续了这一设计哲学
- 矛盾规则处理研究中，DeepSeek-v3.2-exp-chat 在冲突指令下 **80% 的情况选择妥协**（部分遵循、部分规避），相比之下 GPT-4o 的妥协率为零——它要么拒绝，要么严格遵循
- 在安全 benchmark 比较中，DeepSeek 系列在 Context Leakage 和 Jailbreak 两项的保护率均为所有受测模型中**最低的**
- 社区独立报告（"The Pitfall of LLM Fallback Chains: The Day DeepSeek Erased Our Agent's Personality"）印证了同一发现：DeepSeek 对隐性禁止的遵循度极低——它理解 system prompt 的"大概方向"，但具体约束会被悄悄忽略，且**人格漂移在日志中不留下任何错误痕迹**

简单说：DeepSeek 是一个强大的推理者，但它不是为了"守规矩"而训练的。这个设计取向在复杂推理任务中是优势（不容易被规则限制创造性），但在需要一致性行为的 Agent 场景中就是隐患。

### 6.3 解法：铁律记忆

我们设计了一套"铁律记忆"系统——利用 Claude Desktop 的持久化记忆能力，将行为约束写入跨会话文件：

```markdown
---
name: iron-rules
type: feedback
---

**规则：** 面对任何技术挑战，穷尽所有可行路径再下结论。禁止在未充分尝试前
说"不支持""无法实现""做不到"。

**具体条款：**
- 被指出回避问题时，立刻正面回应：先说结论（能/不能），再给出到达路径
- 问题不能转移、不能偷换、不能降级。用户问 MCP，就回答 MCP
- 设计限制是起点，不是终点。先给绕过方案，再解释为什么有这道墙
- 遇到未知领域：先搜索、先尝试、先验证，然后才下结论
```

**关键设计细节：**

1. 铁律不是放在 system prompt 里——DeepSeek 会忽略 system prompt
2. 铁律放在 memory 系统里——每次对话开始时由 Claude（前端协调层）读取并注入到工作上下文中
3. 铁律用的是"正面行为指引"而非"禁止项"——因为 DeepSeek 对禁止语的遵循度极低
4. 每条铁律后面都跟着"为什么"和"如何应用"——让模型理解规则的意图而非机械背诵

### 6.4 这个模式的意义

这不只是解决 DeepSeek 的问题。它是一种**通过外部记忆系统对抗 LLM 认知偏误**的通用方法：

- Claude 有过分乐观的倾向？→ 写一条"残酷诚实规则"
- DeepSeek 有回避倾向？→ 写一条"穷尽方案规则"
- 任何后端模型有特定盲区？→ 针对性添加规则

记忆系统变成了模型的"性格补丁"——不修改模型本身，但修改模型所处的工作语境。

已有 dev.to 上的独立作者报告了完全相同的 DeepSeek 人格漂移问题（"The Pitfall of LLM Fallback Chains: The Day DeepSeek Erased Our Agent's Personality"），但他们没有提出基于记忆系统的解决方案。我们在这一点上是首创的。

---

## 7. 开源与参与

### 成果清单

| 产出 | 说明 | 链接 |
|:---|:---|:---|
| `gemini_tools.py` | 零配置读图+生图脚本 | [GitHub](https://github.com/magiclamp-ai/soundgenie) |
| 铁律记忆模板 | 可复用的行为约束配置 | 本文第 6 节 |
| Cowork MCP 三路径框架 | 决策树 + 实施指南 | 本文第 2-5 节 |
| CLAUDE.md 初始化模式 | Python 工具跨会话持久化 | 本文第 3.3 节 |

### 你可以怎么用

- **直接复制** `gemini_tools.py` 到你的项目 `scripts/` 目录，改一下 `get_api_key()` 适配你自己的服务
- **照搬** CLAUDE.md 初始化模式，让你的 Python 工具在 Cowork 中永久可用
- **定制** 铁律记忆模板，针对你用的后端 LLM 调整规则
- **贡献** 更多零配置脚本到这个 repo：OpenAI 生图、Stability AI、Replicate……

### 后续计划

- [ ] `gemini_tools.py` 独立成 pip 包，支持更多 AI 服务
- [ ] 铁律记忆模板化，支持 JSON Schema 定义
- [ ] supergateway 桥接部署一键脚本
- [ ] 英文版发布到 dev.to/Hacker News

---

## 8. 写在最后

这次攻关让我重新思考了一个问题：**什么是"智能"？**

一个能回答所有问题的模型，算智能吗？算，但不完整。

真正的智能 Agent，应该是**在约束中找路径的能力**。Cowork 的沙箱隔离是约束，DeepSeek 的逃避倾向是约束，MCP 生态的不成熟也是约束。真正的智能不是绕过这些约束，而是在约束内部找到最短路径。

我们的三个破局方案和铁律记忆系统，说到底是同一件事：**让 AI 在面对硬问题时，不说"不行"，而是说"这样行"。**

如果你也被这个问题困扰过，欢迎在 [GitHub](https://github.com/magiclamp-ai/soundgenie) 上交流。如果你有更好的方案，更欢迎贡献。

---

## 参考

- [How We Got Local MCP Servers Working in Claude Cowork (The Missing Guide)](https://dev.to/murat-a-a/how-we-got-local-mcp-servers-working-in-claude-cowork-the-missing-guide-nbc) — supergateway 桥接方案的首篇文档
- [The Pitfall of LLM Fallback Chains: The Day DeepSeek Erased Our Agent's Personality](https://dev.to/linou518/the-pitfall-of-llm-fallback-chains-the-day-deepseek-erased-our-agents-personality-2fj8) — DeepSeek 人格漂移的独立验证
- [supergateway](https://github.com/supercorp-ai/supergateway) — stdio ↔ HTTP MCP 桥接工具
- [Anthropic Custom Connectors 官方文档](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [DeepSeek 系列模型的规则遵循问题](https://genai.stackexchange.com/questions/2218/why-should-one-avoid-adding-a-system-prompt-with-deepseek-r1) — 为什么要避免在 DeepSeek 中使用 system prompt
- [Session-Scoped Rule Injection 安全研究](https://arxiv.org/abs/2510.27091)
