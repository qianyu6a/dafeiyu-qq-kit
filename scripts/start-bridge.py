"""拉起 qq-bridge，并自动对齐 DSH 的当前端口。

背景：DSH 桌面版每次重启都会换一个随机端口（本地实测 19387 → 52481），
config.json 里写死 baseUrl 会导致重启后事件流收到 0 帧、桥接空转。
所以每次启动前扫一次 DSH 进程的监听端口，写回 config.json 再拉起桥接。

stdin 显式接到 DEVNULL：桥接在非 tty 环境下被某些包装器触发过 "stdin is not a tty"。
"""

import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import psutil

REPO = Path(r"D:/AI/qq-bridge")
CONFIG = REPO / "config.json"
LOG = REPO / "bridge.log"
DSH_EXE = "DeepSeek Harness.exe"


def dsh_ports() -> list[int]:
    pids = {
        process.pid
        for process in psutil.process_iter(["name"])
        if (process.info["name"] or "").lower() == DSH_EXE.lower()
    }
    ports = set()
    for connection in psutil.net_connections(kind="inet"):
        if connection.status == "LISTEN" and connection.pid in pids:
            ports.add(connection.laddr.port)
    return sorted(ports)


def responds(port: int) -> bool:
    """能连上并返回 HTTP 状态（哪怕是 401/403）就算活着。"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=3):
            return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def detect_port() -> int | None:
    for port in dsh_ports():
        if responds(port):
            return port
    return None


def sync_config(port: int) -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    config["dsh"]["baseUrl"] = f"http://127.0.0.1:{port}"
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    port = detect_port()
    if port is None:
        print("找不到 DSH 的 HTTP 端口：确认 DeepSeek Harness 已经启动")
        return 1

    sync_config(port)
    print(f"DSH 端口已对齐：{port}")

    log = open(LOG, "ab")
    process = subprocess.Popen(
        ["node", "src/bridge.js"],
        cwd=str(REPO),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    print(f"bridge 已拉起 pid={process.pid}，日志 {LOG}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
