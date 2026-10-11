#!/usr/bin/env python3
"""Check the repository is shaped the way HACS and Home Assistant expect.

Most of what breaks a HACS install is structural, not logical: a manifest
missing its `version`, a brand image at the wrong size, a file the panel loads
that is not actually in the package. None of that shows up until someone tries
to install it, so it is checked here instead.

    python3 tools/verify-package.py
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
PKG = os.path.join(ROOT, "custom_components", "elmer")

fails: list[str] = []
checks = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global checks
    checks += 1
    if not ok:
        fails.append(f"{label}{chr(10) + '    ' + detail if detail else ''}")


def png_size(path: str) -> tuple[int, int] | None:
    """Width and height straight out of the IHDR chunk."""
    with open(path, "rb") as fh:
        head = fh.read(26)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def main() -> int:
    # ---------------------------------------------------------- manifest --
    manifest_path = os.path.join(PKG, "manifest.json")
    check("manifest.json exists", os.path.exists(manifest_path))
    if not os.path.exists(manifest_path):
        return report()

    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)

    # Every one of these is required of a custom integration; `version` in
    # particular is what HACS refuses to install without.
    for key in ("domain", "name", "version", "documentation", "issue_tracker", "codeowners"):
        check(f"manifest has {key}", key in manifest, f"keys: {sorted(manifest)}")

    check("domain matches the folder", manifest.get("domain") == "elmer", str(manifest.get("domain")))
    check(
        "version is a plain semantic version",
        bool(re.fullmatch(r"\d+\.\d+\.\d+", str(manifest.get("version", "")))),
        str(manifest.get("version")),
    )
    for key in ("documentation", "issue_tracker"):
        url = str(manifest.get(key, ""))
        check(f"{key} is an absolute URL", url.startswith("http"), url)
    check(
        "codeowners are @-prefixed",
        all(str(c).startswith("@") for c in manifest.get("codeowners", [])),
        str(manifest.get("codeowners")),
    )
    check(
        "config_flow is declared",
        manifest.get("config_flow") is True,
        "the integration ships a config_flow.py, so this must be true",
    )
    check(
        "a config_flow.py exists to back it",
        os.path.exists(os.path.join(PKG, "config_flow.py")),
    )

    # ------------------------------------------------------------- hacs ---
    hacs_path = os.path.join(ROOT, "hacs.json")
    check("hacs.json exists", os.path.exists(hacs_path))
    if os.path.exists(hacs_path):
        with open(hacs_path, encoding="utf-8") as fh:
            hacs = json.load(fh)
        check("hacs.json names the integration", bool(hacs.get("name")), str(hacs))
        floor = str(hacs.get("homeassistant", ""))
        check(
            "hacs.json sets a minimum Home Assistant version",
            bool(re.fullmatch(r"\d+\.\d+\.\d+", floor)),
            floor,
        )

    # ----------------------------------------------------------- brands ---
    brand = os.path.join(PKG, "brand")
    check("brand folder exists", os.path.isdir(brand))
    if os.path.isdir(brand):
        # Sizes come from the home-assistant/brands spec: icons square at
        # 256 and 512, logos landscape with the shortest side in range.
        for name, want in (("icon.png", 256), ("icon@2x.png", 512),
                           ("dark_icon.png", 256), ("dark_icon@2x.png", 512)):
            p = os.path.join(brand, name)
            if not os.path.exists(p):
                check(f"brand/{name} exists", False)
                continue
            size = png_size(p)
            check(f"brand/{name} is {want}x{want}", size == (want, want), str(size))

        for name, lo, hi in (("logo.png", 128, 256), ("logo@2x.png", 256, 512),
                             ("dark_logo.png", 128, 256), ("dark_logo@2x.png", 256, 512)):
            p = os.path.join(brand, name)
            if not os.path.exists(p):
                check(f"brand/{name} exists", False)
                continue
            w, h = png_size(p)
            short = min(w, h)
            check(f"brand/{name} shortest side is {lo}-{hi}", lo <= short <= hi, f"{w}x{h}")
            check(f"brand/{name} is landscape", w >= h, f"{w}x{h}")

    # --------------------------------------------------------- frontend ---
    fe = os.path.join(PKG, "frontend")
    check("frontend folder exists", os.path.isdir(fe))
    entry = os.path.join(fe, "elmer-panel.js")
    check("the panel's entry point exists", os.path.exists(entry))

    # Every module the panel imports has to be in the package, or the browser
    # 404s on it after install and the sidebar shows an empty page.
    if os.path.isdir(fe):
        missing = []
        for name in os.listdir(fe):
            if not name.endswith(".js"):
                continue
            with open(os.path.join(fe, name), encoding="utf-8") as fh:
                src = fh.read()
            for ref in re.findall(r"""from\s+['"](\./[^'"]+)['"]""", src):
                if not os.path.exists(os.path.join(fe, ref[2:])):
                    missing.append(f"{name} -> {ref}")
        check("every panel import resolves inside the package", not missing, "; ".join(missing))

    # The version in the manifest is what busts the panel's cache, so a stale
    # one hands browsers an old panel after an update.
    init = os.path.join(PKG, "__init__.py")
    if os.path.exists(init):
        with open(init, encoding="utf-8") as fh:
            src = fh.read()
        check("the panel URL carries the manifest version", "?v=" in src)

    # The harness prints a version in the panel's About section. If it drifts
    # from the manifest, the preview advertises a version that does not exist.
    harness = os.path.join(ROOT, "tools", "harness", "fake-hass.js")
    if os.path.exists(harness):
        with open(harness, encoding="utf-8") as fh:
            found = re.search(r"version:\s*'([^']+)'", fh.read())
        check(
            "the preview harness shows the manifest's version",
            bool(found) and found.group(1) == manifest.get("version"),
            f"harness {found.group(1) if found else '?'} vs manifest {manifest.get('version')}",
        )

    # ------------------------------------------------------- the basics ---
    for name in ("README.md", "LICENSE"):
        check(f"{name} exists", os.path.exists(os.path.join(ROOT, name)))

    check(
        "services.yaml documents the services",
        os.path.exists(os.path.join(PKG, "services.yaml")),
    )
    check(
        "translations are present",
        os.path.exists(os.path.join(PKG, "translations", "en.json")),
    )

    # Images the README points at must actually be committed.
    readme = os.path.join(ROOT, "README.md")
    if os.path.exists(readme):
        with open(readme, encoding="utf-8") as fh:
            text = fh.read()
        # Both spellings: markdown ![](x) and the <img src="x"> used wherever a
        # width or a side-by-side row is wanted. Checking only the first let a
        # broken <img> through once already.
        #
        # The README's images have to be absolute, because HACS renders it in
        # its own frontend where a relative path has no repository to resolve
        # against — which is exactly how they came out broken on the HACS page.
        # So: no relative image references at all, and every absolute one that
        # points back into this repository must name a file that exists.
        # Every image of ours has to declare a size. Without one it renders
        # at its natural width, and these are retina captures — the desktop
        # shot is 2360px across. GitHub happens to clamp to the column, but
        # HACS renders the same README in a much narrower frontend.
        ours = re.findall(r"<img[^>]*raw\.githubusercontent[^>]*>", text)
        unsized = [t for t in ours if "width=" not in t and "height=" not in t]
        check(
            "every README image declares a width or a height",
            not unsized,
            f"{len(unsized)} without: {[t[:70] for t in unsized]}",
        )

        # Every screenshot exists in both themes. They used to be captured
        # by separate blocks and only Routines had a dark counterpart, so the
        # two could drift to different screens without anything noticing.
        images_dir = os.path.join(ROOT, "images")
        if os.path.isdir(images_dir):
            shots = [
                f[:-4] for f in os.listdir(images_dir)
                if f.endswith(".png") and not f.endswith("-dark.png") and "logo" not in f
            ]
            missing = [n for n in sorted(shots)
                       if not os.path.exists(os.path.join(images_dir, f"{n}-dark.png"))]
            check("every screenshot has a dark counterpart", not missing, str(missing))

        # No <picture>. HACS renders this same README in its own frontend,
        # which does not support it and printed the raw <source> tag as text
        # across the top of the page. One logo in a mid-tone carries on a
        # light page and a dark one without needing it.
        check(
            "the README uses no <picture> (HACS prints the tags as text)",
            "<picture" not in text and "prefers-color-scheme" not in text,
        )
        check(
            "and the logo is the one that reads on either background",
            "images/readme_logo.png" in text,
            "images/logo.png is dark ink, which vanishes on a dark page",
        )

        # The My Home Assistant button has the owner and repository baked
        # into its query string, so renaming either one leaves a button that
        # silently opens nothing. Check it against the manifest's own
        # documentation URL rather than against a copy of the name here.
        doc = str(manifest.get("documentation", ""))
        slug = re.search(r"github\.com/([\w.-]+)/([\w.-]+)", doc)
        my = re.findall(
            r"my\.home-assistant\.io/redirect/hacs_repository/\?([^)\s\"']+)", text
        )
        check("the README offers the My Home Assistant button", len(my) >= 1, f"{len(my)} found")
        if my and slug:
            owner, repo = slug.group(1), slug.group(2)
            # Parsed, not matched as a substring: "repository=elmer-ha" is
            # inside "repository=elmer-ha-OLD", so a renamed repository
            # sailed through the first version of this check.
            want = {"owner": owner, "repository": repo, "category": "integration"}
            wrong = [
                q for q in my
                if {k: v[0] for k, v in urllib.parse.parse_qs(q).items()} != want
            ]
            check(
                "and every one of them points at this repository",
                not wrong,
                f"expected owner={owner} repository={repo}; bad: {wrong}",
            )

        relative = re.findall(r"!\[[^\]]*\]\((?!https?://)([^)\s]+)", text)
        relative += re.findall(r"""<img[^>]+src=['"](?!https?://)([^'"]+)""", text)
        check(
            "the README has no relative image paths (HACS cannot resolve them)",
            not relative,
            "; ".join(relative),
        )

        raw_prefix = "https://raw.githubusercontent.com/"
        absolute = re.findall(r"!\[[^\]]*\]\((https?://[^)\s]+)", text)
        absolute += re.findall(r"""<img[^>]+src=['"](https?://[^'"]+)""", text)
        broken = []
        for url in absolute:
            if not url.startswith(raw_prefix):
                continue
            # .../<owner>/<repo>/<ref>/<path in repo>
            parts = url[len(raw_prefix):].split("/", 3)
            if len(parts) == 4 and not os.path.exists(os.path.join(ROOT, parts[3])):
                broken.append(url)
        check("every image the README links to exists in the repo", not broken, "; ".join(broken))

    # --- the sidebar icon ------------------------------------------------
    # Home Assistant's sidebar takes an icon name, never an image, so Elmer's
    # own mark gets there through a custom icon set: one filled path, derived
    # from the stroked mark the panel draws. Derived is the risk — the mark can
    # be edited without regenerating this, and the sidebar would then go on
    # showing the old drawing with nothing to say so.
    sidebar = os.path.join(PKG, "frontend", "sidebar-icon.js")
    check("the sidebar icon ships with the integration", os.path.exists(sidebar))
    if os.path.exists(sidebar):
        with open(sidebar, encoding="utf-8") as fh:
            js = fh.read()
        with open(os.path.join(PKG, "const.py"), encoding="utf-8") as fh:
            const = fh.read()

        check("it registers an icon set", "window.customIconsets" in js)
        # It is loaded on every Home Assistant page, including pages that have
        # nothing to do with Elmer, so it declares an icon and does nothing
        # else. Anything reaching for the document or the network does not
        # belong in a file with that reach.
        check(
            "and does nothing else on pages that are not Elmer's",
            not any(t in js for t in ("document.", "fetch(", "localStorage", "addEventListener")),
        )

        setname = re.search(r"window\.customIconsets\.(\w+)", js)
        named = re.search(r'PANEL_ICON\s*=\s*"([^"]+)"', const)
        check("the panel names an icon from a set", bool(setname and named and ":" in named.group(1)))
        if setname and named and ":" in named.group(1):
            check(
                "and it is the set this file registers",
                named.group(1).split(":")[0] == setname.group(1),
                f"{named.group(1)} vs {setname.group(1)}",
            )

        # The one that matters: rebuild from the mark and compare.
        built = subprocess.run(
            ["node", os.path.join(ROOT, "tools", "build-sidebar-icon.mjs"), "--check"],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        check(
            "and it is still the mark the panel draws",
            built.returncode == 0,
            (built.stderr or built.stdout).strip(),
        )


    return report()


def report() -> int:
    if fails:
        print(f"FAIL — {len(fails)} of {checks} checks\n")
        for f in fails:
            print(f"  {f}")
        return 1
    print(f"PASS — {checks} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
