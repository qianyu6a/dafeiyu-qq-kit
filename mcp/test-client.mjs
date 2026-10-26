import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** 只验证工具注册和本地后端能不能起来，不发任何 QQ 消息。 */

const transport = new StdioClientTransport({
  command: 'node',
  args: ['server.mjs'],
  stderr: 'inherit',
});

const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('可用工具:', tools.tools.map((tool) => tool.name).join(', '));

console.log('\n[1/2] 试画一张（首次会拉起 ComfyUI，约 40 秒）...');
const drawn = await client.callTool({
  name: 'dafeiyu_draw',
  arguments: { prompt: 'holding a bowl of white rice, sitting at table, warm lighting' },
});
console.log(drawn.content[0].text.slice(0, 300));

console.log('\n[2/2] 试说一句（首次会拉起 GPT-SoVITS，约 90 秒）...');
const spoken = await client.callTool({
  name: 'dafeiyu_speak',
  arguments: { text: '我把这张图画好了，你看喜不喜欢。' },
});
console.log(spoken.content[0].text.slice(0, 300));

await client.close();
