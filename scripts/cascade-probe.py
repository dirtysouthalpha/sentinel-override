"""Real-cascade verification for dashboard-prime.html.

WHY THIS EXISTS
    Every Part-3/Part-4 bug was a CASCADE bug — the CSS parsed, the elements
    existed, and the page still rendered a blank drawer and a bottom tab bar
    that had never appeared at any width. The jest suite runs on linkedom,
    which parses CSS but does not cascade it, so it can only assert source
    order and media bounds. This asserts the RESULT: getComputedStyle and
    getBoundingClientRect from Blink.

WHY THE SCRIPT IS STRIPPED
    Driving the live page headlessly does not terminate: it opens an SSE
    stream that never closes and a ping retry chain that reschedules
    forever, so --virtual-time-budget never reaches idle and Chrome hangs
    (measured: >180s, twice). The script's behaviour is already covered by
    tests/web-dashboard-prime-load.test.js, which executes the real inline
    script against a stubbed network. What is NOT covered anywhere else is
    the cascade — so this harness keeps the markup and the CSS verbatim,
    drops only the <script>, and adds the drawer-open class statically.

    python run_probe.py
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

PRIME = Path(r"C:\AgentLink\sentinel-override\web\dashboard-prime.html")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = Path(__file__).parent / "chrome-dump-profile"

SELECTORS = ['#btabs', '#omni', '#settings-btn', '#pill-brain', '#pill-desktop',
             '#pill-fleet', '#sidebar', '#sb-footer', '#sb-search',
             '#model-sel', '#hbg', '#top-overflow', '#cmd-palette']

PROBE_JS = """
<script>
window.addEventListener('load', function () {
  var sels = %s;
  var out = {};
  sels.forEach(function (sel) {
    var el = document.querySelector(sel);
    if (!el) { out[sel] = { missing: true }; return; }
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    out[sel] = { display: cs.display, visibility: cs.visibility,
                 w: Math.round(r.width), h: Math.round(r.height) };
  });
  var pre = document.createElement('pre');
  pre.id = 'probe-out';
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
});
</script>
""" % json.dumps(SELECTORS)


def build(drawer_open: bool) -> Path:
    html = PRIME.read_text(encoding="utf-8", errors="replace")
    # Drop the page's own script — markup and CSS stay byte-identical.
    html = re.sub(r"<script>.*?</script>", "", html, flags=re.S)
    if drawer_open:
        html = html.replace('<aside id="sidebar"', '<aside class="mob-open" id="sidebar"', 1)
    html = html.replace("</body>", PROBE_JS + "</body>")
    tmp = Path(tempfile.gettempdir()) / f"prime-probe-{'open' if drawer_open else 'closed'}.html"
    tmp.write_text(html, encoding="utf-8")
    return tmp


def dump(path: Path, width: int) -> dict:
    out = subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
         "--no-default-browser-check", f"--user-data-dir={PROFILE}",
         f"--window-size={width},900", "--virtual-time-budget=4000",
         "--dump-dom", path.as_uri()],
        # bytes, not text: the DOM dump carries UTF-8 the console codepage
        # (cp1252) cannot decode, and text=True crashes the reader thread.
        capture_output=True, timeout=120)
    stdout = out.stdout.decode("utf-8", errors="replace")
    m = re.search(r'<pre id="probe-out">(.*?)</pre>', stdout, re.S)
    if not m:
        raise RuntimeError("no probe output; tail=" + stdout[-300:])
    return json.loads(m.group(1))


def has_target(state, sel):
    d = state.get(sel) or {}
    return (not d.get("missing") and d.get("display") != "none"
            and d.get("visibility") != "hidden"
            and d.get("w", 0) > 0 and d.get("h", 0) > 0)


def main() -> int:
    failures = []
    closed_page, open_page = build(False), build(True)

    for width in (1600, 375):
        data = dump(closed_page, width)
        print(f"\n=== {width}px ===")
        for sel in SELECTORS:
            print(f"  {sel:16} {data.get(sel)}")

        # Part 3: four controls used to have NO mouse affordance at any width.
        for sel in ("#omni", "#settings-btn", "#pill-brain", "#pill-desktop",
                    "#pill-fleet"):
            if not has_target(data, sel):
                failures.append(f"{width}px {sel}: no hit target -> {data.get(sel)}")

        # Deleted, not restyled.
        for sel in ("#top-overflow", "#cmd-palette"):
            if not (data.get(sel) or {}).get("missing"):
                failures.append(f"{width}px {sel}: should no longer exist")

        if width <= 767:
            # #btabs had never rendered at ANY width before Part 4.
            if not has_target(data, "#btabs"):
                failures.append(f"375px #btabs: not rendered -> {data.get('#btabs')}")
            # The hamburger is the only TOUCH affordance for the drawer —
            # #btabs' Files tab opens the file explorer, not the sidebar,
            # and Ctrl+B does not exist on a phone.
            if not has_target(data, "#hbg"):
                failures.append(f"375px #hbg: drawer unreachable by touch -> {data.get('#hbg')}")
            # And the drawer must have CONTENT when open — the v11 test
            # asserted the mob-open class and passed against an empty one.
            drawer = dump(open_page, width)
            print("  --- drawer open ---")
            for sel in ("#sb-footer", "#sb-search", "#model-sel"):
                print(f"  {sel:16} {drawer.get(sel)}")
                if not has_target(drawer, sel):
                    failures.append(f"375px drawer {sel}: blank -> {drawer.get(sel)}")
        else:
            if has_target(data, "#btabs"):
                failures.append("1600px #btabs: must not show on desktop")
            if not has_target(data, "#sb-footer"):
                failures.append(f"1600px #sb-footer: hidden -> {data.get('#sb-footer')}")

    print()
    if failures:
        print(f"{len(failures)} FAILURES:")
        for f in failures:
            print("  [x] " + f)
        return 1
    print("[+] real-cascade checks passed at 1600px and 375px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
