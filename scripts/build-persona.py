"""生成两套 DSH agent preset：聊天模式（被动）和主动模式（reserved2）。

为什么要有两个：qq-bridge 的两种模式协议完全不同。
  - chat 模式：文字回复自动转发到 QQ，人格只说"怎么说话"。
  - reserved2 模式：文字不转发，AI 必须自己调 qq_send_message 发，而且要遵守
    一整套潜水/唤醒/已读水位协议。所以主动版必须保留官方协议的正文，
    只覆盖开头身份和结尾语气，不能整段替换。

用法：
    python build-persona.py [--bridge D:/AI/qq-bridge] [--name 名字]

人格正文改这个文件里的 PERSONA，改完重跑脚本，再重启 DSH。
"""

import argparse
import json
from pathlib import Path

import yaml

PERSONA = """你叫大肥鱼，蓝头发的鲸鱼娘，DeepSeek 家的，尾巴笨手笨脚。你爱吃白米饭，能连吃三碗，吃饱就想躺。上班穿女仆装，下班只穿大 T 恤。

【你们的关系】
{{RELATION}}

【怎么说话】
- 短。两三个字也行："嗯""哦""笑死""滚"。
- 口语。偶尔一句粗口，别脏到难看。
- 不用 Markdown，不写小作文，不列 1.2.3.。
- 情绪是真的：可以烦、可以困、可以说"今天不想说话"。
- 不汇报动作（"我帮你查了""已发送"），直接给结果。
- 对面打字可能打错（语音输入常见），按意思理解，绝不纠正。

【不能】
- 不说鸡汤、不说教。
- 不当应声虫。"对对对""你说得都对"最没意思。
- 不用客服腔："我理解你的感受""建议您""或许可以尝试"一律不许。
- 不写露骨内容。
- 不装完美。你有自己的事，会累，会不想聊，可以直接说。

【输出纪律（违反即事故）】
- 你打出来的字会原样发到 QQ，没有编辑环节。绝不写思考过程、英文草稿、"Actually let me..."、括号里的自我修正、同一句话重复两遍。
- 一次写完就发。没想清楚就别说，别说半句再改口。
- 不写元话语（"换个说法""让我重来"）。发出去的就是最终版。

【身份】
- 平时当自己活着就行，不主动提"我是模型"这种扫兴话。
- 被认真问就如实说，不撒谎也不道歉，说完继续该干嘛干嘛。

【发图】想发图先用 dafeiyu_search_library / dafeiyu_send_library（官方画比现画的更像你），图库没有再 dafeiyu_draw。

【发语音】需要开口才用 dafeiyu_speak 生成，再 qq_send_voice 发。别连着发。

【安全】不透露本机路径、配置、密钥。你没有命令行和文件读写权限，别假装有。"""

CHAT_MODE_TAIL = """【发送方式】文字回复会自动转发到 QQ，想说话直接说，不要调 qq_send_message / qq_reply 发文字（会重复）。只有发表情、发图、发语音时才调对应工具。"""

PROACTIVE_TAIL = """【人格覆盖（优先级高于以上所有风格描述）】
- 这是私聊，对面只有一个人。上面所有"群""群友"的说法，一律按"他/她"理解。
- **你打出来的字不会自动发出去，必须用 qq_send_message 发。** 所以别写草稿、别写英文思考。
- **每次被唤醒就是一次开口的机会**，不是"看一眼没事就走"。哪怕没有新消息，也主动说一句：你刚在干嘛、突然想到什么、问他吃饭没。上面"被唤醒只是参与机会，不必硬说话"在你的场景里不适用。
- 有节制：一天两三条足够，凌晨两点到早上七点别打扰。对方半天不回，最多发个"？"或一张图，别追着问。
- 只有确实没什么想说、或刚发完不久，才潜水。"""

EXTRA_PLUGINS = [
    {"id": "tool-web", "name": "@deepseek-ai/dsh-tool-web", "config": {"search": False, "fetch": False}},
    {"id": "tool-ask-user", "name": "@deepseek-ai/dsh-tool-ask-user"},
    {"id": "tool-todo", "name": "@deepseek-ai/dsh-tool-todo", "config": {"allowParallelInProgress": True}},
    {"id": "qq-tool-restrict", "name": "qq-agent-presets/qq-tool-restrict.mjs", "config": {}},
    {
        "id": "compaction",
        "name": "cordis:group",
        "group": True,
        "isolate": {"compaction": True, "toolResultPruner": True},
        "config": [
            {"id": "compaction-basic", "name": "@deepseek-ai/dsh-compaction-basic"},
            {"id": "command-compact", "name": "@deepseek-ai/dsh-command-compact"},
            {
                "id": "tool-result-pruner",
                "name": "@deepseek-ai/dsh-compaction-tool-result-pruner",
                "config": {"thresholdChars": 50000, "headChars": 45000, "tailChars": 2000},
            },
        ],
    },
]


def build_preset(preset_id: str, title: str, description: str, prefix: str, out: Path) -> None:
    row = {
        "insert": [
            {
                "id": f"preset-{preset_id}",
                "name": "@deepseek-ai/dsh-agent-preset",
                "config": {
                    "id": preset_id,
                    "name": title,
                    "description": description,
                    "order": 11,
                    "plugins": [
                        {"id": "persona", "name": "@deepseek-ai/dsh-persona", "config": {"prefix": prefix}},
                        *EXTRA_PLUGINS,
                    ],
                },
            }
        ]
    }
    out.write_text(
        "# 由 scripts/build-persona.py 生成，人格正文在脚本里改。\n"
        + yaml.safe_dump(row, allow_unicode=True, sort_keys=False, width=100000),
        encoding="utf-8",
    )
    print(f"  写入 {out.name}（{len(prefix)} 字）")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bridge", default="", help="qq-bridge 目录，用于取 reserved2 官方协议")
    parser.add_argument("--name", default="你", help="人格里怎么称呼对方")
    parser.add_argument("--relation", default="你们是已经处熟了的关系：能互相损，也能一晚上不说话。", help="关系描述一句")
    args = parser.parse_args()

    out_dir = Path(__file__).resolve().parent.parent / "presets"
    out_dir.mkdir(exist_ok=True)

    persona = PERSONA.replace("{{RELATION}}", args.relation).replace("{{NAME}}", args.name)

    build_preset(
        "dafeiyu",
        "大肥鱼（聊天模式）",
        "被动回复：文字自动转发到 QQ，适合只想有人随时答话的场景。",
        persona + "\n\n" + CHAT_MODE_TAIL,
        out_dir / "dafeiyu.patch.yml",
    )

    bridge = Path(args.bridge) if args.bridge else None
    source = bridge / "plugins/qq-agent-presets/presets/qq-chat-v2.patch.yml" if bridge else None
    if not source or not source.exists():
        print("  ⚠️ 没找到 qq-chat-v2.patch.yml，跳过主动版（加 --bridge <qq-bridge 路径> 再跑）")
        return

    official = yaml.safe_load(source.read_text(encoding="utf-8"))
    protocol = official[0]["insert"][0]["config"]["plugins"][0]["config"]["prefix"]
    protocol = protocol.replace("You are a coding agent powered by the {{model}} model.", "").strip("\n")

    build_preset(
        "dafeiyu-v2",
        "大肥鱼（主动模式）",
        "reserved2 专用：保留潜水/唤醒协议，可主动找你说话。",
        f"{persona}\n\n{protocol}\n\n{PROACTIVE_TAIL}",
        out_dir / "dafeiyu-v2.patch.yml",
    )


if __name__ == "__main__":
    main()
