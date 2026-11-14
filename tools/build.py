#!/usr/bin/env python3
"""Build index.html (what GitHub Pages serves) from src/gully-scorer.html.

The page carries a strict Content-Security-Policy that pins the inline script by
its SHA-256 hash, so ANY change to the inline <script> needs this build, or the
browser will refuse to run the page.

Usage:  python3 tools/build.py
"""
import base64, hashlib, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "gully-scorer.html"
OUT = ROOT / "index.html"
SITE = "https://samuvelmaniraj.github.io/gully-scorer"

h = SRC.read_text()
inline = re.findall(r"<script>(.*?)</script>", h, re.S)
assert len(inline) == 1, "expected exactly one inline <script> in the source"
js = inline[0]
sha = base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()

relay = re.search(r'const OWN_RELAY = "([^"]*)";', h).group(1)
connect = f"{relay} {relay.replace('https://', 'wss://')}" if relay else "https://ntfy.sh wss://ntfy.sh"
csp = (f"default-src 'none'; script-src 'sha256-{sha}' {SITE}/qrcode.min.js; style-src 'unsafe-inline'; "
       f"img-src data: blob:; connect-src {connect}; base-uri 'none'; form-action 'none'")

head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="referrer" content="no-referrer">\n'
        f'<meta http-equiv="Content-Security-Policy" content="{csp}">\n'
        '<meta name="robots" content="noindex,nofollow">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}[hidden]{display:none!important}</style>\n')
body = h.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
title, rest = body.split("\n", 1)
end = rest.index("</style>") + len("</style>")
OUT.write_text(head + title + "\n" + rest[:end] + "\n</head>\n<body>\n" + rest[end:] + "\n</body>\n</html>\n")
print(f"built {OUT.name}: {OUT.stat().st_size} bytes, script hash {sha[:12]}…")
