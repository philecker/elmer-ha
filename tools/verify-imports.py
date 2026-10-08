#!/usr/bin/env python3
"""Check every Home Assistant symbol this integration imports actually exists.

The integration cannot be run here — Home Assistant's own dependency tree does
not build on this Python — but the thing most likely to break a custom
integration is not logic, it is an API that moved: a helper renamed, a function
removed in favour of an async one, a constant relocated. That is checkable from
the source alone.

Install the source without its dependencies and point this at it:

    pip install --no-deps homeassistant
    python3 tools/verify-imports.py

For each `from homeassistant.x import A, B` it finds the module on disk and
confirms A and B are defined there — as a def, class, assignment, or a symbol
the module itself re-exports. Attribute use on an imported module (for example
``panel_custom.async_register_panel``) is checked the same way.

Exit code is non-zero if anything is missing, so CI can gate on it.
"""

from __future__ import annotations

import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "custom_components", "elmer")


def ha_root() -> str | None:
    for base in sys.path:
        candidate = os.path.join(base, "homeassistant")
        if os.path.isdir(candidate) and os.path.exists(os.path.join(candidate, "const.py")):
            return candidate
    return None


def module_file(root: str, dotted: str) -> str | None:
    """homeassistant.components.http -> its .py or package __init__.py."""
    parts = dotted.split(".")
    assert parts[0] == "homeassistant"
    rel = os.path.join(root, *parts[1:])
    if os.path.isfile(rel + ".py"):
        return rel + ".py"
    if os.path.isfile(os.path.join(rel, "__init__.py")):
        return os.path.join(rel, "__init__.py")
    return None


def exported(path: str) -> set[str]:
    """Names a module provides: its own definitions plus what it re-exports."""
    with open(path, encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), path)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, getattr(ast, "TypeAlias", ())) and isinstance(node.name, ast.Name):
            # PEP 695: `type ConfigType = dict[str, Any]`, which Home Assistant
            # now uses for most of its type aliases. Guarded with getattr so this
            # still parses on a Python older than 3.12.
            names.add(node.name.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "*":
                    continue
                names.add(alias.asname or alias.name.split(".")[0])
    return names


def main() -> int:
    root = ha_root()
    if not root:
        print("homeassistant source not found on sys.path.", file=sys.stderr)
        print("Run: pip install --no-deps homeassistant", file=sys.stderr)
        return 2

    version = "unknown"
    try:
        with open(os.path.join(root, "const.py"), encoding="utf-8") as fh:
            src = fh.read()
        import re

        major = re.search(r"^MAJOR_VERSION[^\d]*(\d+)", src, re.M)
        minor = re.search(r"^MINOR_VERSION[^\d]*(\d+)", src, re.M)
        if major and minor:
            version = f"{major.group(1)}.{minor.group(1)}"
    except OSError:
        pass

    problems: list[str] = []
    checked = 0
    # module alias -> dotted path, so `panel_custom.async_register_panel` can be
    # traced back to homeassistant.components.panel_custom.
    files = sorted(f for f in os.listdir(PKG) if f.endswith(".py"))

    for name in files:
        path = os.path.join(PKG, name)
        with open(path, encoding="utf-8") as fh:
            tree = ast.parse(fh.read(), path)

        aliases: dict[str, str] = {}

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if not node.module or not node.module.startswith("homeassistant"):
                    continue
                target = module_file(root, node.module)
                if target is None:
                    problems.append(f"{name}: no module {node.module}")
                    continue
                have = exported(target)
                for alias in node.names:
                    checked += 1
                    if alias.name not in have:
                        # A submodule is a legitimate thing to import by name.
                        if module_file(root, f"{node.module}.{alias.name}"):
                            aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
                            continue
                        problems.append(
                            f"{name}: {node.module} has no {alias.name!r}"
                        )
                    elif module_file(root, f"{node.module}.{alias.name}"):
                        aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"

            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("homeassistant"):
                        aliases[alias.asname or alias.name] = alias.name

        # Attribute access on an imported Home Assistant module.
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in aliases
            ):
                dotted = aliases[node.value.id]
                target = module_file(root, dotted)
                if target is None:
                    continue
                checked += 1
                if node.attr not in exported(target):
                    # It may be a submodule of a package, e.g. components.http.
                    if module_file(root, f"{dotted}.{node.attr}"):
                        continue
                    problems.append(f"{name}: {dotted} has no {node.attr!r}")

    print(f"Home Assistant {version} at {root}")
    if problems:
        print(f"\nFAIL — {len(problems)} of {checked} references do not resolve\n")
        for p in sorted(set(problems)):
            print(f"  {p}")
        return 1
    print(f"PASS — {checked} references into homeassistant.* all resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
