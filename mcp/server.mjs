/**
 * 大肥鱼 QQ 机器人专用 MCP server。
 *
 * 工具：
 *   dafeiyu_draw           写提示词出图（ComfyUI + LoRA）
 *   dafeiyu_speak          文字转语音（GPT-SoVITS），直接落到 qq-bridge 的 audio/ 目录
 *   dafeiyu_send_image     走 OneBot 直接发图（base64，不受表情库限制）
 *   dafeiyu_search_library 在本地图库里按关键词找图
 *   dafeiyu_send_library   直接发图库里的现成图
 *
 * 两个推理后端「用的时候才起」：端口没监听就先拉起来，再等就绪。
 * 这样 DSH 开机不会被两个吃显存的推理服务拖住。
 *
 * 路径全部可以用环境变量覆盖，见下方常量。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const COMFY_URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';
const TTS_URL = process.env.TTS_URL ?? 'http://127.0.0.1:9880';
const IMAGE_DIR = process.env.IMAGE_DIR ?? 'D:/AI/out/images';
const AUDIO_DIR = process.env.AUDIO_DIR ?? 'D:/AI/qq-bridge/audio';
const ONEBOT_URL = process.env.ONEBOT_URL ?? 'http://127.0.0.1:3000';
const BRIDGE_CONFIG = process.env.BRIDGE_CONFIG ?? 'D:/AI/qq-bridge/config.json';
const IMAGE_HTTP_PORT = Number(process.env.IMAGE_HTTP_PORT ?? 8899);
const IMAGE_HTTP_BASE = process.env.IMAGE_HTTP_BASE ?? '';

const COMFY_HOME = process.env.COMFY_HOME ?? 'D:/AI/ComfyUI_windows_portable';
const COMFY_PY = `${COMFY_HOME}/python_embeded/python.exe`;
const CKPT = 'Counterfeit-V3.0_fp16.safetensors';
const LORA = process.env.LORA_NAME ?? 'dafeiyu_whalemaid_v2.safetensors';
const TRIGGER = 'dafeiyu_whalemaid';

const TTS_HOME = 'D:/AI/GPT-SoVITS-pkg/GPT-SoVITS-v2pro-20261006nvidia50x0';
const TTS_PY = `${TTS_HOME}/runtime/python.exe`;
const REF_AUDIO = 'D:/AI/tools/xiaoyi_ref.wav';
const REF_TEXT = '嗨，很高兴认识你，今天我们从哪里开始呢？一起带着好奇心出发，去发现生活里的小惊喜吧！';

const children = new Map();
let imageServerStarted = false;

/** 端口上有没有服务在听：能连上就算活着。 */
async function isUp(url, timeoutMs = 1500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    // 401/404 也说明服务活着
    return response.status > 0;
  } catch {
    return false;
  }
}

async function waitUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

function spawnDetached(name, command, args, cwd) {
  if (children.has(name)) return;
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  children.set(name, child.pid);
  console.error(`[dafeiyu-tools] 启动 ${name} (pid ${child.pid})`);
}

async function ensureComfy() {
  if (await isUp(COMFY_URL)) return;
  spawnDetached('comfyui', COMFY_PY, ['-s', 'ComfyUI/main.py', '--port', '8188', '--listen', '127.0.0.1'], COMFY_HOME);
  if (!(await waitUp(COMFY_URL, 180000))) throw new Error('ComfyUI 没能在 180 秒内起来，检查 D:/AI/ComfyUI_windows_portable');
}

async function ensureTts() {
  if (await isUp(`${TTS_URL}/docs`)) return;
  spawnDetached(
    'gpt-sovits',
    TTS_PY,
    ['api_v2.py', '-a', '127.0.0.1', '-p', '9880', '-c', 'GPT_SoVITS/configs/tts_infer.yaml'],
    TTS_HOME,
  );
  if (!(await waitUp(`${TTS_URL}/docs`, 240000))) throw new Error('GPT-SoVITS 没能在 240 秒内起来');
}

/** 出图结果要能被 QQ 侧取走，所以起一个只读的本地图片服务。 */
async function ensureImageServer() {
  if (imageServerStarted) return;
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const server = http.createServer(async (request, response) => {
    const name = path.basename(decodeURIComponent(request.url ?? '/'));
    if (!name || name.includes('..')) {
      response.writeHead(400).end('bad request');
      return;
    }
    try {
      const data = await fs.readFile(path.join(IMAGE_DIR, name));
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      response.end(data);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(IMAGE_HTTP_PORT, '127.0.0.1', resolve));
  imageServerStarted = true;
  console.error(`[dafeiyu-tools] 图片服务 http://127.0.0.1:${IMAGE_HTTP_PORT}/`);
}

function buildWorkflow({ prompt, width, height, steps, seed }) {
  const positive = `${TRIGGER}, 1girl, solo, ${prompt}`;
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    2: {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: LORA,
        strength_model: 0.85,
        strength_clip: 0.85,
        model: ['1', 0],
        clip: ['1', 1],
      },
    },
    3: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['2', 1] } },
    4: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'lowres, bad anatomy, bad hands, extra fingers, text, watermark, signature, multiple girls',
        clip: ['2', 1],
      },
    },
    5: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg: 7,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
      },
    },
    7: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    8: { class_type: 'SaveImage', inputs: { filename_prefix: 'qq', images: ['7', 0] } },
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

/** 从桥接的 config.json 读 SnowLuma 的 OneBot token（密钥不写进代码）。 */
async function onebotToken() {
  const raw = await fs.readFile(BRIDGE_CONFIG, 'utf8');
  const config = JSON.parse(raw);
  const token = config?.snowluma?.accessToken;
  if (!token) throw new Error('qq-bridge/config.json 里没有 snowluma.accessToken');
  return token;
}

/**
 * 通过 OneBot 直接发图片（base64 CQ 码）。
 * bridge 的发送接口只有文本/语音/表情，没有图片口；表情口只认表情库 id，不认任意 URL。
 */
async function sendImageByOneBot(key, file) {
  const token = await onebotToken();
  const raw = await fs.readFile(file);
  const message = `[CQ:image,file=base64://${raw.toString('base64')}]`;

  const [kind, id] = String(key).split(':');
  const isGroup = kind === 'group';
  if (!isGroup && !/^\d+$/.test(id ?? '')) throw new Error(`key 格式应为 private:<QQ号> 或 group:<群号>，收到 ${key}`);

  const response = await fetch(`${ONEBOT_URL}/${isGroup ? 'send_group_msg' : 'send_private_msg'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(isGroup ? { group_id: Number(id), message } : { user_id: Number(id), message }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (result?.status !== 'ok') throw new Error(`OneBot 返回 ${JSON.stringify(result).slice(0, 200)}`);
  return result;
}

/** 本地图库索引（官方原画 271 张），搜不到时用来兜底。 */
const LIBRARY_INDEX = 'D:/AI/dafeiyu/library-index.json';
let libraryCache = null;

async function loadLibrary() {
  if (!libraryCache) {
    libraryCache = JSON.parse(await fs.readFile(LIBRARY_INDEX, 'utf8'));
  }
  return libraryCache;
}

/** 关键词匹配：文件名（拼音，如 shuijiao / baozhe）+ WD14 英文 tag 都算。 */
async function searchLibrary(query, limit) {
  const library = await loadLibrary();
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[\s,_-]+/)
    .filter(Boolean);

  const scored = library.map((item) => {
    const name = item.name.toLowerCase();
    const tags = item.tags.map((tag) => tag.toLowerCase());
    let score = 0;
    for (const word of words) {
      if (name.includes(word)) score += 3;
      if (tags.some((tag) => tag.includes(word))) score += 2;
    }
    return { ...item, score };
  });

  const matched = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const picked = (matched.length ? matched : scored).slice(0, limit);
  return picked.map(({ name, file, tags, score }) => ({ name, file, tags: tags.slice(0, 8), score }));
}

const server = new McpServer({ name: 'dafeiyu-tools', version: '1.0.0' });

server.tool(
  'dafeiyu_draw',
  '画一张全新的图（ComfyUI 本地出图，约 10~30 秒）。只在图库里找不到合适场景时才用——日常聊天优先 dafeiyu_send_library。prompt 用英文描述场景和动作，别重复描述她的外貌（外貌由模型自带）。',
  {
    prompt: z.string().min(3).describe('英文场景描述，例如 "holding a bowl of white rice, sitting at table, warm lighting"'),
    width: z.number().int().min(384).max(1024).optional().describe('宽，默认 512'),
    height: z.number().int().min(384).max(1024).optional().describe('高，默认 768'),
    steps: z.number().int().min(12).max(50).optional().describe('采样步数，默认 28'),
    seed: z.number().int().optional().describe('随机种子，不传则随机'),
  },
  async ({ prompt, width, height, steps, seed }) => {
    try {
      await ensureComfy();
      await ensureImageServer();
      const usedSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);
      const submitted = await postJson(`${COMFY_URL}/prompt`, {
        prompt: buildWorkflow({
          prompt,
          width: width ?? 512,
          height: height ?? 768,
          steps: steps ?? 28,
          seed: usedSeed,
        }),
        client_id: 'dafeiyu-mcp',
      });

      const promptId = submitted.prompt_id;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const response = await fetch(`${COMFY_URL}/history/${promptId}`, { signal: AbortSignal.timeout(10000) });
        const history = await response.json();
        const entry = history?.[promptId];
        if (!entry) continue;
        if (entry.status?.status_str === 'error') {
          return { content: [{ type: 'text', text: `出图失败：${JSON.stringify(entry.status).slice(0, 400)}` }], isError: true };
        }
        const image = entry.outputs?.['8']?.images?.[0];
        if (!image) continue;

        const source = path.join(COMFY_HOME, 'ComfyUI', 'output', image.filename);
        const target = path.join(IMAGE_DIR, image.filename);
        await fs.copyFile(source, target);
        const url = `${IMAGE_HTTP_BASE || `http://127.0.0.1:${IMAGE_HTTP_PORT}`}/${image.filename}`;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, file: target, url, seed: usedSeed, prompt }),
            },
          ],
        };
      }
      return { content: [{ type: 'text', text: '出图超时（180 秒）' }], isError: true };
    } catch (error) {
      return { content: [{ type: 'text', text: `出图出错：${error?.message ?? error}` }], isError: true };
    }
  },
);

server.tool(
  'dafeiyu_speak',
  '用大肥鱼的声音把一段话念出来（GPT-SoVITS + 官方贝壳音色），约 3~8 秒合成。返回的 filename 直接传给 qq_send_voice 就能发语音。文本要口语化、短句，别带 Markdown 和颜文字。',
  {
    text: z.string().min(1).max(300).describe('要念的中文文本，建议一次不超过 80 字'),
    filename: z.string().optional().describe('保存的文件名（不含扩展名），不传自动生成'),
  },
  async ({ text, filename }) => {
    try {
      await ensureTts();
      const params = new URLSearchParams({
        text,
        text_lang: 'zh',
        ref_audio_path: REF_AUDIO,
        prompt_text: REF_TEXT,
        prompt_lang: 'zh',
        text_split_method: 'cut5',
        batch_size: '1',
        media_type: 'wav',
        streaming_mode: 'false',
      });
      const response = await fetch(`${TTS_URL}/tts?${params}`, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
      const audio = Buffer.from(await response.arrayBuffer());

      await fs.mkdir(AUDIO_DIR, { recursive: true });
      const name = (filename ?? `dafeiyu_${Date.now()}`).replace(/[^\w.-]/g, '_');
      const target = path.join(AUDIO_DIR, `${name}.wav`);
      await fs.writeFile(target, audio);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, file: target, filename: `${name}.wav`, bytes: audio.length }),
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `合成失败：${error?.message ?? error}` }], isError: true };
    }
  },
);

server.tool(
  'dafeiyu_send_image',
  '把一张图片直接发到 QQ 会话（走 OneBot，base64 内嵌，不需要公网 URL）。画完图必须立刻调它，别用 qq_send_sticker——那个只认表情库 id。',
  {
    key: z.string().describe('会话标识：private:<QQ号> 或 group:<群号>，跟桥接给的 key 一致'),
    file: z.string().describe('图片绝对路径，或 dafeiyu_draw 返回的 file'),
  },
  async ({ key, file }) => {
    try {
      const target = path.isAbsolute(file) ? file : path.join(IMAGE_DIR, file);
      const result = await sendImageByOneBot(key, target);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, file: target, messageId: result?.data?.message_id }) }],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `发图失败：${error?.message ?? error}` }], isError: true };
    }
  },
);

server.tool(
  'dafeiyu_search_library',
  '在本地官方图库里找现成的图（271 张原画，含大量梗图：抱着鲸鱼睡觉、被浇水、抱着扫帚、看 token 等）。聊天里要发图优先用这个，比现画快得多也更像本人。文件名是拼音，query 用拼音或英文关键词最准，例如 "shuijiao sleep"、"baozhe"、"weixie"、"token"。返回按相关度排序的候选。',
  {
    query: z.string().describe('关键词，拼音或英文，空格分隔多个，如 "baozhe jingyu shuijiao"'),
    limit: z.number().int().min(1).max(30).optional().describe('返回条数，默认 10'),
  },
  async ({ query, limit }) => {
    try {
      const items = await searchLibrary(query, limit ?? 10);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, count: items.length, items }) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `检索失败：${error?.message ?? error}` }], isError: true };
    }
  },
);

server.tool(
  'dafeiyu_send_library',
  '从本地图库直接发一张现成的图（不用画）。name 传 dafeiyu_search_library 返回的名字，或直接给拼音关键词（会取最匹配的一张）。发完可以在文字里配一句吐槽。',
  {
    key: z.string().describe('会话标识：private:<QQ号> 或 group:<群号>'),
    name: z.string().describe('图的名字（如 deepseek-baozhe-jingyu-shuijiao）或拼音关键词'),
  },
  async ({ key, name }) => {
    try {
      const [best] = await searchLibrary(name, 1);
      if (!best) throw new Error(`图库里没找到「${name}」`);
      const result = await sendImageByOneBot(key, best.file);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, name: best.name, messageId: result?.data?.message_id }),
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `发图失败：${error?.message ?? error}` }], isError: true };
    }
  },
);

await server.connect(new StdioServerTransport());
console.error('[dafeiyu-tools] 已就绪：draw / speak / send_image / search_library / send_library');
