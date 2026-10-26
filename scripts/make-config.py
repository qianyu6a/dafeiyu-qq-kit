"""从 config.example.json 生成 config.json，并填入你自己的身份信息。

用法：
    python make-config.py --owner 123456789 --allow-private 123456789 --ffmpeg C:/ffmpeg/bin/ffmpeg.exe

只做三件事：填 ownerQQ、填白名单、填 ffmpeg 路径。其余（MCP 地址、唤醒频率、
语音开关）沿用模板里的默认值，需要改就直接编辑生成出来的 config.json。
"""

import argparse
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
TEMPLATE = BASE / "config.example.json"
TARGET = BASE / "config.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 qq-bridge 配置")
    parser.add_argument("--owner", required=True, help="你自己的 QQ 号（管理员身份）")
    parser.add_argument(
        "--allow-private",
        default="",
        help="允许私聊的 QQ 号，逗号分隔；留空则只放行 owner",
    )
    parser.add_argument("--allow-groups", default="", help="允许响应的群号，逗号分隔；留空即不进群")
    parser.add_argument("--ffmpeg", default="C:/ffmpeg/bin/ffmpeg.exe", help="ffmpeg.exe 路径")
    args = parser.parse_args()

    config = json.loads(TEMPLATE.read_text(encoding="utf-8"))

    owner = int(args.owner)
    private = [int(item) for item in args.allow_private.split(",") if item.strip()] or [owner]
    groups = [int(item) for item in args.allow_groups.split(",") if item.strip()]

    config["ownerQQ"] = owner
    config["allow"] = {"private": private, "groups": groups}
    config["socialV2"]["voice"]["ffmpegPath"] = args.ffmpeg

    TARGET.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"已生成 {TARGET}")
    print(f"  ownerQQ      {owner}")
    print(f"  私聊白名单   {private}")
    print(f"  群白名单     {groups or '（空，不进群）'}")
    print("下一步：填 SnowLuma 的 accessToken，或直接启动桥接让它自动自愈")


if __name__ == "__main__":
    main()
