#!/usr/bin/env python3
import re, subprocess, os, json

os.chdir("/a0/usr/workdir/sentinel-override-latest")

print("=== DOM ID MISMATCHES ===")
js_ids = set()
for root, dirs, files in os.walk("popup-modules"):
    for f in files:
        if not f.endswith(".js"):
            continue
        path = os.path.join(root, f)
        with open(path) as fh:
            js_ids.update(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", fh.read()))

with open("popup.html") as fh:
    html_ids = set(re.findall(r'id="([^"]+)"', fh.read()))

missing_in_html = sorted(js_ids - html_ids)
print(f"IDs referenced in popup-modules JS but NOT found in popup.html: {len(missing_in_html)}")
for mid in missing_in_html:
    loc = subprocess.run(["grep", "-rn", f"getElementById('{mid}')", "popup-modules/"], capture_output=True, text=True).stdout.strip().split("\n")[0]
    print(f"  MISSING: {mid}  ({loc})")

unused_in_js = sorted(html_ids - js_ids)
print(f"\nIDs defined in popup.html but never referenced in popup-modules JS: {len(unused_in_js)}")
for uid in unused_in_js:
    print(f"  UNUSED: {uid}")

print("\n=== MESSAGE HANDLER COVERAGE ===")
popup_actions = set()
for root, dirs, files in os.walk("popup-modules"):
    for f in files:
        if not f.endswith(".js"):
            continue
        path = os.path.join(root, f)
        with open(path) as fh:
            popup_actions.update(re.findall(r"action:\s*['\"]([^'\"]+)['\"]", fh.read()))
for pf in ["popup-full.js"]:
    if os.path.exists(pf):
        with open(pf) as fh:
            popup_actions.update(re.findall(r"action:\s*['\"]([^'\"]+)['\"]", fh.read()))

with open("background/index.js") as fh:
    bg_content = fh.read()
handled_cases = set(re.findall(r"case\s+['\"]([^'\"]+)['\"]:\s*", bg_content))

unhandled = sorted(popup_actions - handled_cases)
print(f"Actions sent by popup but NOT handled in background/index.js: {len(unhandled)}")
for u in unhandled:
    print(f"  UNHANDLED: {u}")

all_bg_files = []
for root, dirs, files in os.walk("background"):
    for f in files:
        if f.endswith(".js") and not f.endswith(".test.js"):
            all_bg_files.append(os.path.join(root, f))

mp_cases = set()
for bf in all_bg_files:
    if bf == "background/index.js":
        continue
    with open(bf) as fh:
        mp_cases.update(re.findall(r"case\s+['\"]([^'\"]+)['\"]:\s*", fh.read()))

still_unhandled = sorted(set(unhandled) - mp_cases)
found_in_others = sorted(set(unhandled) & mp_cases)
if found_in_others:
    print(f"\n  (Found in other background files, not in index.js: {len(found_in_others)})")
    for s in found_in_others:
        print(f"  FOUND_ELSEWHERE: {s}")
if still_unhandled:
    print(f"\n  (Still unhandled ANYWHERE: {len(still_unhandled)})")
    for s in still_unhandled:
        print(f"  TRULY_UNHANDLED: {s}")

print("\n=== getErrorMessage DEFINITION ===")
for pattern in ["window.getErrorMessage", "function getErrorMessage", "getErrorMessage ="]:
    result = subprocess.run(["grep", "-rn", pattern, "popup-modules/", "popup-full.js"], capture_output=True, text=True).stdout.strip()
    if result:
        print(f"Pattern '{pattern}':")
        for line in result.split("\n")[:5]:
            print(f"  {line}")
