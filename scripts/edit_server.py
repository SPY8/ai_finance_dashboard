#!/usr/bin/env python3
"""
数据编辑器保存服务（方案 B）。

在本地起一个 HTTP 服务，既托管静态看板站点，又开 /__edit__/* 三个 API 让
editor.html 直接把编辑后的 JSON 写回 data/：

    GET  /__edit__/list            列出可编辑的 data/*.json
    GET  /__edit__/load?file=xxx   读 data/<file>
    POST /__edit__/save            body {file, data, note} → 先 backup_data.py 再原子写
    GET  /__edit__/rates?date=YYYY-MM-DD 按快照日期查询历史汇率

设计原则（与 CLAUDE.md / AGENTS.md 一致）：
- 只写 data/（私有，被 gitignore），绝不碰 demo_data/，绝不提交。
- 白名单文件名，防路径穿越；只绑 127.0.0.1，不暴露外网。
- 写盘前先 backup_data.py 打快照；写盘用 临时文件 + os.replace 原子替换。
- 失败 fail loud。

启动：
    python3 scripts/edit_server.py [port]
    # 默认 8765，浏览器打开 http://127.0.0.1:8765/editor.html
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from rates import fetch_historical_rates

SCRIPT_DIR = Path(__file__).resolve().parent
BASE = SCRIPT_DIR.parent
DATA = BASE / "data"

# 可编辑白名单（顶层 JSON 文件）。transactions/ 子目录由各自 yearly 脚本管，先不纳入。
WHITELIST = {
    "recurring.json",
    "target.json",
    "history.json",
    "liabilities.json",
    "income_events.json",
    "risks.json",
    "policies.json",
    "categories.json",
}

# ponytail: 简易 MIME 表，够托管静态站点用；缺省走 octet-stream。
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def backup(reason: str) -> bool:
    """调 backup_data.py 打快照。失败打印但不阻塞保存（备份失败不应吞掉用户的编辑）。"""
    try:
        r = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "backup_data.py"), reason],
            cwd=str(BASE),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if r.returncode != 0:
            print(f"[edit_server] backup_data.py 非零退出: {r.stderr.strip()}", file=sys.stderr)
            return False
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[edit_server] backup 失败: {e}", file=sys.stderr)
        return False


def atomic_write(path: Path, text: str) -> None:
    """临时文件 + os.replace 原子写，避免写一半崩溃留下坏 JSON。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # ensure_ascii=False 保留中文可读；末尾换行对齐编辑器手写习惯（由调用方控制 indent）
    payload = text if text.endswith("\n") else text + "\n"
    tmp.write_text(payload, encoding="utf-8")
    os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    server_version = "AFD-Edit/1.0"

    # ---------- 静态文件托管 ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/__edit__/"):
            return self._api_get(parsed)
        return self._static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/__edit__/save":
            return self._api_save()
        self._send_json(404, {"ok": False, "error": "not found"})

    # ---------- API ----------
    def _api_get(self, parsed):
        action = parsed.path.rsplit("/", 1)[-1]
        if action == "rates":
            q = parse_qs(parsed.query)
            snapshot_date = (q.get("date", [""])[0] or "").strip()
            try:
                result = fetch_historical_rates(snapshot_date)
            except Exception as e:  # noqa: BLE001
                return self._send_json(400, {"ok": False, "error": f"historical rates lookup failed: {e}"})
            return self._send_json(200, {"ok": True, **result})
        if action == "list":
            files = []
            if DATA.is_dir():
                for name in sorted(WHITELIST):
                    p = DATA / name
                    files.append({
                        "name": name,
                        "exists": p.is_file(),
                        "size": p.stat().st_size if p.is_file() else 0,
                        "mtime": dt.datetime.fromtimestamp(p.stat().st_mtime).isoformat() if p.is_file() else None,
                    })
            return self._send_json(200, {"files": files})
        if action == "load":
            q = parse_qs(parsed.query)
            name = (q.get("file", [""])[0] or "").strip()
            if name not in WHITELIST:
                return self._send_json(400, {"ok": False, "error": f"file not whitelisted: {name}"})
            p = DATA / name
            if not p.is_file():
                return self._send_json(404, {"ok": False, "error": f"not found: {name}"})
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                return self._send_json(500, {"ok": False, "error": f"parse failed: {e}"})
            return self._send_json(200, {"ok": True, "name": name, "data": data})
        return self._send_json(404, {"ok": False, "error": f"unknown action: {action}"})

    def _api_save(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            return self._send_json(400, {"ok": False, "error": f"bad json body: {e}"})
        name = (body.get("file") or "").strip()
        data = body.get("data")
        note = (body.get("note") or "").strip() or "editor save"
        if name not in WHITELIST:
            return self._send_json(400, {"ok": False, "error": f"file not whitelisted: {name}"})
        if data is None:
            return self._send_json(400, {"ok": False, "error": "missing data"})
        # 服务端兜底校验：必须是合法 JSON 对象/数组，且能往返
        try:
            text = json.dumps(data, ensure_ascii=False, indent=2)
            json.loads(text)
        except Exception as e:  # noqa: BLE001
            return self._send_json(400, {"ok": False, "error": f"data not serializable: {e}"})

        backup(f"editor: {name} — {note}")
        try:
            atomic_write(DATA / name, text)
        except Exception as e:  # noqa: BLE001
            return self._send_json(500, {"ok": False, "error": f"write failed: {e}"})
        return self._send_json(200, {"ok": True, "name": name, "bytes": len(text)})

    # ---------- 静态文件 ----------
    def _static(self, urlpath):
        clean = urlpath.split("?", 1)[0].split("#", 1)[0]
        if clean in ("", "/"):
            clean = "/index.html"
        rel = clean.lstrip("/")
        if ".." in rel.split("/"):
            return self._send_text(400, "bad path")
        p = (BASE / rel).resolve()
        try:
            p.relative_to(BASE.resolve())
        except ValueError:
            return self._send_text(400, "bad path")
        if not p.is_file():
            return self._send_text(404, "not found")
        mime = MIME.get(p.suffix.lower(), "application/octet-stream")
        body = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # ---------- helpers ----------
    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # 静态资源刷屏太吵，只记 API 调用
        if "/__edit__/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def main(argv):
    port = 8765
    if len(argv) > 1:
        try:
            port = int(argv[1])
        except ValueError:
            print(f"非法端口: {argv[1]}", file=sys.stderr)
            return 1
    if not DATA.is_dir():
        print(f"[edit_server] 警告: data/ 不存在 ({DATA})，load/save 会 404", file=sys.stderr)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[edit_server] http://127.0.0.1:{port}/editor.html  (Ctrl+C 退出)")
    print(f"[edit_server] data dir: {DATA}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[edit_server] bye")
    finally:
        srv.server_close()
    return 0


def _selfcheck():
    """__main__ 自检：白名单拒绝、原子写往返、临时文件不残留。跑在临时目录上，不碰真实数据。"""
    tmp = Path(__file__).resolve().parent.parent / "data" / "_selfcheck_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    global DATA
    DATA = tmp
    (tmp / "recurring.json").write_text(
        json.dumps({"note": "test", "incomes": [], "expenses": []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    atomic_write(tmp / "recurring.json", json.dumps({"note": "v2", "incomes": [{"k": 1}]}, ensure_ascii=False))
    back = json.loads((tmp / "recurring.json").read_text(encoding="utf-8"))
    assert back["note"] == "v2" and back["incomes"][0]["k"] == 1, "atomic_write 往返失败"
    assert not (tmp / "recurring.json.tmp").exists(), "临时文件残留"
    assert "../etc/passwd" not in WHITELIST, "白名单漏放"
    print("[selfcheck] OK: atomic_write 往返 + 白名单拒绝 + 临时文件清理")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selfcheck":
        _selfcheck()
        raise SystemExit(0)
    raise SystemExit(main(sys.argv))
