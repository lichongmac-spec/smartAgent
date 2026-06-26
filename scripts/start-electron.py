#!/usr/bin/env python3
"""
start-electron.py — 通过 fork+exec 启动 Electron，完全脱离 WorkBuddy 进程树
解决 macOS 沙箱导致 Electron SIGSEGV 的问题。

用法：
  python3 scripts/start-electron.py
  或（通过 pnpm）：
  pnpm electron:start
"""
import os
import signal
import sys

# ── 路径 ─────────────────────────────────────────────
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
electron_bin = os.path.join(
    project_root,
    'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'
)
app_path = project_root

# ── 干净的环境变量 ───────────────────────────────────
# 关键：不继承 NODE_OPTIONS、ELECTRON_RUN_AS_NODE 等可能污染 Electron 启动的变量
clean_env = {}
for key in ('PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'LOGNAME'):
    if key in os.environ:
        clean_env[key] = os.environ[key]

if 'TMPDIR' not in clean_env:
    clean_env['TMPDIR'] = '/tmp'
if 'PATH' not in clean_env:
    clean_env['PATH'] = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'


def main():
    if not os.path.isfile(electron_bin):
        sys.stderr.write(f'Electron binary not found: {electron_bin}\n')
        sys.stderr.write('Run: pnpm add -D electron@33\n')
        sys.exit(1)

    # 第一次 fork：子进程将创建新会话
    pid = os.fork()
    if pid != 0:
        # ── 父进程（Python 脚本）──
        # 注册信号处理器：把 Ctrl+C / SIGTERM 转发给子进程
        def forward_signal(signum, _frame):
            try:
                os.kill(pid, signum)
            except OSError:
                pass
        signal.signal(signal.SIGINT, forward_signal)
        signal.signal(signal.SIGTERM, forward_signal)

        # 等待子进程退出
        _, status = os.waitpid(pid, 0)
        if os.WIFEXITED(status):
            sys.exit(os.WEXITSTATUS(status))
        elif os.WIFSIGNALED(status):
            sys.exit(128 + os.WTERMSIG(status))
        sys.exit(0)

    # ── 子进程 ──
    # 创建新会话，完全脱离父进程的进程组 / 终端
    os.setsid()

    # exec Electron（当前进程被 Electron 替换）
    try:
        os.execve(
            electron_bin,
            ['Electron', app_path],
            clean_env,
        )
    except OSError as e:
        # execve 失败时写到 stderr
        sys.stderr.write(f'Failed to start Electron: {e}\n')
        sys.stderr.flush()
        os._exit(1)


if __name__ == '__main__':
    main()
