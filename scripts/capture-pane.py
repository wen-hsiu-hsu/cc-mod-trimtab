#!/usr/bin/env python3
"""Capture a mod's real pane as SVG for its docs.

Usage: scripts/capture-pane.py <mod> [<shot>...] [--text]

Runs `claude --plugin-dir mods/<mod>` in a pty under an empty config dir, with the mod's store
filled by `scripts/pane-shots/<mod>.py` (made-up data, never your own), opens the pane with
that file's `OPEN` command, sends each shot's keys, reads the screen with pyte and writes the pane box to
docs/images/<mod>/<shot>.svg. `--text` prints the screens instead of writing images.

Needs Python 3 with pyte (`python3 -m venv .venv && .venv/bin/pip install pyte`) and a `claude`
on PATH. Nothing is sent to the API: the session is not logged in.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
import pty
import select
import signal
import struct
import sys
import tempfile
import termios
import time
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

try:
    import pyte
except ImportError:
    sys.exit('capture-pane: needs pyte (python3 -m venv .venv && .venv/bin/pip install pyte, then run it with .venv/bin/python)')

ROOT = Path(__file__).resolve().parent.parent
ROWS = 80
# The dark theme's palette, for the 16 named colors.
BACKGROUND = '#1e1e1e'
FOREGROUND = '#d4d4d4'
NAMED = {
    'black': '#000000', 'red': '#cd3131', 'green': '#0dbc79', 'brown': '#e5e510', 'yellow': '#e5e510',
    'blue': '#2472c8', 'magenta': '#bc3fbc', 'cyan': '#11a8cd', 'white': '#e5e5e5',
    'brightblack': '#666666', 'brightred': '#f14c4c', 'brightgreen': '#23d18b', 'brightbrown': '#f5f543',
    'brightyellow': '#f5f543', 'brightblue': '#3b8eea', 'brightmagenta': '#d670d6', 'brightcyan': '#29b8db',
    'brightwhite': '#ffffff',
}
CELL_W, CELL_H, FONT = 8.4, 18, 14


class Screen(pyte.Screen):
    """pyte drops SGR 2 (dim); keep it in the `blink` flag, which the panes never use."""

    def select_graphic_rendition(self, *attrs, **kwargs):
        super().select_graphic_rendition(*attrs, **kwargs)
        dim = self.cursor.attrs.blink
        codes = list(attrs) or [0]
        i = 0
        while i < len(codes):
            code = codes[i]
            if code in (38, 48):
                i += 2 if codes[i + 1:i + 2] == [5] else 4
                continue
            if code == 2:
                dim = True
            elif code in (0, 22):
                dim = False
            i += 1
        self.cursor.attrs = self.cursor.attrs._replace(blink=dim)


def load_shots(mod):
    path = ROOT / 'scripts' / 'pane-shots' / f'{mod}.py'
    if not path.exists():
        sys.exit(f'capture-pane: no {path.relative_to(ROOT)}')
    spec = importlib.util.spec_from_file_location(f'pane_shots_{mod}', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


def seed(config, plugin, cwd, data):
    """An onboarded, empty config dir whose store for an inline `plugin` holds `data`."""
    (config / '.claude.json').write_text(json.dumps({
        'hasCompletedOnboarding': True,
        'theme': 'dark',
        'projects': {str(cwd): {'hasTrustDialogAccepted': True}},
    }))
    store = config / 'plugins' / 'store'
    store.mkdir(parents=True)
    name = f'{plugin}_inline-{hashlib.sha256(f"{plugin}@inline".encode()).hexdigest()[:12]}.json'
    (store / name).write_text(json.dumps(data))


class Session:
    def __init__(self, cols, mod_dir, config, cwd):
        self.screen = Screen(cols, ROWS)
        self.stream = pyte.ByteStream(self.screen)
        env = {key: value for key, value in os.environ.items() if not key.startswith('CLAUDE_CODE_') and key != 'CLAUDECODE'}
        env.update(CLAUDE_CONFIG_DIR=str(config), COLUMNS=str(cols), LINES=str(ROWS), TERM='xterm-256color', COLORTERM='truecolor')
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            os.execvpe('claude', ['claude', '--plugin-dir', str(mod_dir)], env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, cols, 0, 0))

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([self.fd], [], [], 0.05)
            if ready:
                try:
                    self.stream.feed(os.read(self.fd, 65536))
                except OSError:
                    return

    def settle(self, quiet=1.0, limit=15):
        """Read until the screen's text has not changed for `quiet` seconds."""
        start = last = time.time()
        seen = self.screen.display
        while time.time() - last < quiet and time.time() - start < limit:
            ready, _, _ = select.select([self.fd], [], [], 0.05)
            if ready:
                try:
                    self.stream.feed(os.read(self.fd, 65536))
                except OSError:
                    return
                if self.screen.display != seen:
                    seen = self.screen.display
                    last = time.time()

    def step(self, step):
        kind, _, arg = step.partition(':')
        if kind == 'wait':
            self.pump(float(arg))
        elif kind == 'keys':
            os.write(self.fd, arg.encode().decode('unicode_escape').encode())
            self.settle()
        else:
            sys.exit(f'capture-pane: unknown step {step!r}')

    def close(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass


def pane_box(screen):
    """The rows and columns of the last box drawn with ╭ … ╯."""
    lines = screen.display
    bottom = max((row for row, line in enumerate(lines) if '╰' in line), default=None)
    if bottom is None:
        return None
    left = lines[bottom].index('╰')
    right = lines[bottom].rindex('╯')
    top = max(row for row in range(bottom) if lines[row][left:left + 1] == '╭')

    return top, bottom, left, right


def color(value, default):
    if value == 'default':
        return default
    if value in NAMED:
        return NAMED[value]
    if len(value) == 6:
        return f'#{value}'

    return default


def svg(screen, box):
    top, bottom, left, right = box
    width = (right - left + 1) * CELL_W
    height = (bottom - top + 1) * CELL_H
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height + 16:.0f}" viewBox="-8 -8 {width + 16:.1f} {height + 16}">',
        f'<rect x="-8" y="-8" width="{width + 16:.1f}" height="{height + 16}" rx="6" fill="{BACKGROUND}"/>',
        f'<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="{FONT}" xml:space="preserve">',
    ]
    for row in range(top, bottom + 1):
        line = screen.buffer[row]
        y = (row - top) * CELL_H
        col = left
        runs = []
        while col <= right:
            char = line[col]
            fg, bg = char.fg, char.bg
            if char.reverse:
                fg, bg = bg, fg
            style = (color(fg, FOREGROUND), color(bg, None) if bg != 'default' else None, char.bold, char.italics, char.blink)
            wide = col + 1 <= right and line[col + 1].data == ''
            if runs and runs[-1][0] == style:
                runs[-1][1].append((col, char.data))
            else:
                runs.append((style, [(col, char.data)]))
            col += 2 if wide else 1
        for (fg, bg, bold, italics, dim), chars in runs:
            if bg:
                first, last = chars[0][0], chars[-1][0]
                out.append(f'<rect x="{(first - left) * CELL_W:.1f}" y="{y}" width="{(last - first + 1) * CELL_W:.1f}" height="{CELL_H}" fill="{bg}"/>')
            shown = [(col, data) for col, data in chars if data.strip()]
            if not shown:
                continue
            xs = ' '.join(f'{(col - left) * CELL_W:.1f}' for col, _ in shown)
            text = escape(''.join(data for _, data in shown))
            attrs = f' fill="{fg}"'
            attrs += ' font-weight="bold"' if bold else ''
            attrs += ' font-style="italic"' if italics else ''
            attrs += ' opacity="0.5"' if dim else ''
            out.append(f'<text x="{xs}" y="{y + CELL_H - 5}"{attrs}>{text}</text>')
    out.append('</g></svg>')

    return '\n'.join(out) + '\n'


def main(argv):
    flags = [arg for arg in argv if arg.startswith('--')]
    args = [arg for arg in argv if not arg.startswith('--')]
    if not args or set(flags) - {'--text'}:
        sys.exit(__doc__)
    mod, wanted = args[0], set(args[1:])
    module = load_shots(mod)
    shots = [shot for shot in module.SHOTS if not wanted or shot['name'] in wanted]
    if wanted - {shot['name'] for shot in shots}:
        sys.exit(f'capture-pane: no shot {", ".join(sorted(wanted - {shot["name"] for shot in shots}))}')
    out_dir = ROOT / 'docs' / 'images' / mod
    for shot in shots:
        with tempfile.TemporaryDirectory(prefix='capture-pane-') as tmp:
            config, cwd = Path(tmp).resolve() / 'config', Path(tmp).resolve() / 'work'
            config.mkdir()
            cwd.mkdir()
            seed(config, module.PLUGIN, cwd, module.store(datetime.now()))
            session = Session(shot['cols'], ROOT / 'mods' / mod, config, cwd)
            try:
                session.settle(quiet=2.0, limit=30)
                session.step(f'keys:{module.OPEN}\\r')
                session.settle(quiet=1.5)
                for step in shot['steps']:
                    session.step(step)
                screen = session.screen
                box = pane_box(screen)
                if '--text' in flags or box is None:
                    print(f'== {shot["name"]} ({shot["cols"]} columns)')
                    print('\n'.join(line.rstrip() for line in screen.display).rstrip())
                if box is None:
                    sys.exit(f'capture-pane: {shot["name"]}: no pane on the screen')
                if '--text' not in flags:
                    out_dir.mkdir(parents=True, exist_ok=True)
                    path = out_dir / f'{shot["name"]}.svg'
                    path.write_text(svg(screen, box))
                    print(f'wrote {path.relative_to(ROOT)}')
            finally:
                session.close()


if __name__ == '__main__':
    main(sys.argv[1:])
