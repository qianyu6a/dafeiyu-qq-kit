# 大肥鱼 QQ 机器人 · 搭建工具包

把「本地大模型 + QQ + 画图 + 语音」串成一个能私聊的机器人，人格是大肥鱼（DeepSeek 家的蓝发鲸鱼娘）。

这个仓库**不含任何图片、模型权重和个人数据**，只放自己写的那部分代码、配置模板和踩过的坑。

---

## 它是怎么跑起来的

```
QQ 客户端（小号）
   ↕  SnowLuma（注入 QQ 进程，提供 OneBot v11）
qq-bridge（消息桥接：白名单、人格、工具白名单、控制台）
   ↕  HTTP
DSH 桌面版（DeepSeek Harness，跑 agent 的大脑）
   ├─ dafeiyu-mcp（本仓库的 MCP server）
   ├─ ComfyUI（画图，可选）
   └─ GPT-SoVITS（语音，可选）
```

一句话：**QQ 只是嘴巴，脑子是本机的 agent，画图和说话是另外两个本地服务。**

## 需要你自己准备的东西

| 东西 | 说明 |
|---|---|
| QQ 小号 | 绝对不要用主号。注入型工具违反腾讯协议，封的是这个号 |
| [SnowLuma](https://github.com/SnowLuma/SnowLuma) | 负责注入 QQ、提供 OneBot v11 接口。**不随本仓库分发**，去官方下 |
| [qq-bridge](https://github.com/Derpyu520/qq-bridge) | 消息桥接、人格、白名单、控制台。MIT |
| [DSH 桌面版](https://www.deepseek.com/harness/) | agent 运行时。Windows 装 `dsh-latest-windows-x64.exe` |
| Node.js 20+ | 跑 MCP server 和桥接 |
| Python 3.10+ | 跑本仓库的脚本（`pip install psutil pyyaml`） |
| ComfyUI（可选） | 想让她画图才需要 |
| GPT-SoVITS（可选） | 想让她发语音才需要 |

---

## 搭建步骤

### 1. 装 DSH 并跑通一次

装完打开，随便聊一句确认能用。DSH 会把数据放在 `~/.dsh/`。

### 2. 装 SnowLuma，注入小号

1. 解压 SnowLuma，双击 `launcher.bat`
2. 浏览器开 `http://localhost:5099`，账号 `admin`，密码在启动窗口的日志里
3. 左侧「进程注入」→ 选中登录的小号 QQ → 注入
4. 「节点配置」→ 打开 HTTP(3000) 和 WebSocket(3001)
5. 记下 OneBot 的 access token（在 `config/onebot_<QQ号>.json` 里）

> 每次重启电脑都要重新注入一次。SnowLuma 的 `config/runtime.json` 里有个 `hookAutoLoad`，改成 `true` 可以自动加载——但那就是无人值守注入了，你自己判断要不要开。

### 3. 克隆 qq-bridge

```bash
git clone https://github.com/Derpyu520/qq-bridge.git
cd qq-bridge
npm install --registry=https://registry.npmmirror.com
```

`npm install` 会跑一个 postinstall 脚本修补 `@snowluma/sdk`（13 个文件），这是桥接作者做的兼容补丁，别跳过。

### 4. 打一个必须的补丁

打开 `plugins/qq-agent-presets/qq-tool-restrict.mjs`，在 `SAFE_PREFIXES` 数组里加一行：

```js
'mcp__dafeiyu__',
```

**不加的话，QQ 会话里模型的工具清单里根本不会有画图/语音工具**——不是报错，是静默消失，很难查。

### 5. 装 MCP server

把本仓库的 `mcp/` 复制到任意位置（比如 `D:/AI/dafeiyu-mcp`）：

```bash
cd mcp
npm install
```

测一下：

```bash
node test-client.mjs      # 会调一次画图和语音，确认后端通
```

### 6. 生成 config.json

```bash
cp config.example.json 到 qq-bridge 目录
python scripts/make-config.py --owner <你的QQ> --allow-private <你的QQ>
```

然后把 SnowLuma 的 token 填进 `config.json` 的 `snowluma.accessToken`（不填也行，桥接会自己从 SnowLuma 的配置里读）。

### 7. 生成人格 preset

```bash
python scripts/build-persona.py --bridge <qq-bridge 路径> --name <怎么称呼你>
```

会在 `presets/` 下生成两个文件，复制到 `<qq-bridge>/plugins/qq-agent-presets/presets/`，然后把它们加进
`plugins/qq-agent-presets/package.json` 的 `dsh.bundle.patch` 数组：

```json
"patch": [
  "./presets/qq-chat.patch.yml",
  "./presets/qq-chat-v2.patch.yml",
  "./presets/dafeiyu.patch.yml",
  "./presets/dafeiyu-v2.patch.yml"
]
```

再把它俩 id 注册进桥接配置：

```json
"agentPreset": "dafeiyu",              // chat 模式用这个
"socialV2": { "agentPreset": "dafeiyu-v2" }   // reserved2 模式用这个
```

### 8. 跑起来

```bash
node scripts/setup-dsh.mjs desktop     # 在 qq-bridge 目录
python <本仓库>/scripts/start-bridge.py
```

`start-bridge.py` 会自动找到 DSH 当前的端口（见下面的坑），然后拉起桥接。

---

## 踩过的坑（按痛苦程度排序）

### DSH 的 HTTP 端口每次重启都会变

上一秒 19387，重启后 52481，再重启 58956。`config.json` 里 `dsh.baseUrl` 写死端口的话，桥接会「连上事件流但收到 0 帧」然后指数退避，看起来像协议不兼容，实际上是端口对不上。

**别直接 `node src/bridge.js`，用 `start-bridge.py`**——它每次启动前扫一遍 DSH 的监听端口，探测哪个能应答 HTTP，写回配置再拉起桥接。

### YAML 缩进错一格，整个 bundle 静默失效

preset 文件里 persona 的正文是 `prefix: |-` 块标量，**每一行必须比 `prefix:` 多缩进两格以上**。少缩进一行的后果不是报错，而是整个 `qq-agent-presets` bundle 加载失败，四个 preset 全部消失，桥接报「preset 不在可用清单中」。

改完一定要验证：

```bash
python -c "import yaml; yaml.safe_load(open('presets/dafeiyu.patch.yml', encoding='utf-8'))"
```

### chat 模式会把模型的思考当正文发出去

chat 模式下文字自动转发，模型起草时改口的内容（`Actually let me...`、英文草稿）也会一起发出去。人格里必须写死【输出纪律】，见 `scripts/build-persona.py`。

### 两种模式的人格不能混用

- `chat`：文字自动转发，人格只管"怎么说话"
- `reserved2`（主动模式）：文字**不**转发，必须调 `qq_send_message`；还有一整套潜水/唤醒/已读水位协议

把 chat 用的短人格丢进 reserved2，它会一条话都不说。

### 桥接的表情接口不认图片 URL

`qq_send_sticker` 只接受表情库里的 id。想发图得走 OneBot 原生 `send_private_msg` + base64 CQ 码，本仓库的 `dafeiyu_send_image` 就是这么做的。

### MCP 调用默认 60 秒超时

冷启动 GPT-SoVITS 要 90 秒以上，必超时。注册 MCP 时给 `toolCallTimeoutMs: 300000`。

---

## 关于素材和模型

本仓库**不包含**：

- 大肥鱼的图片素材（[EDMOK/blue-fish-archive](https://github.com/EDMOK/blue-fish-archive)，CC BY-NC-SA 二创协议，自己 clone）
- 训练好的 LoRA 权重（用 `scripts/train-lora.py` 自己训，素材同上，仅限非商业）
- ComfyUI / GPT-SoVITS 的模型文件

图库索引用 `scripts/build-library.py` 生成：读素材目录 + WD14 打的标签，输出一个 `library-index.json`，MCP server 用它做关键词检索。

## 许可与免责

- 本仓库自有代码：MIT
- qq-bridge：MIT（本仓库不复制其源码，只提供补丁说明）
- SnowLuma：**不随本仓库分发**，使用前请阅读其 EULA；它的 §5.4 禁止打包进第三方安装包/镜像、禁止自动化脚本部署
- 图片素材：CC BY-NC-SA，禁止商用
- QQ 进程注入违反腾讯用户协议，账号有被封风险。**用小号，别进公开群**，机器人背后是个能读写本机的 agent——群里任何人发一句话都可能驱动它
