"""
Bundle the project's `src/` package into a single zip the website can
fetch and unpack into Pyodide's virtual filesystem in one go.

The output (`docs/assets/src_bundle.zip`) is generated from the canonical
`src/` directory each time this script runs — no duplicated source tree
in git. Re-run after editing any `src/*.py` file.

Usage:
    python tools/build_src_bundle.py
"""

import os
import sys
import zipfile

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SRC_DIR   = os.path.join(_REPO_ROOT, "src")
_OUT_PATH  = os.path.join(_REPO_ROOT, "docs", "assets", "src_bundle.zip")


def main():
    if not os.path.isdir(_SRC_DIR):
        print(f"error: {_SRC_DIR} not found", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(_OUT_PATH), exist_ok=True)

    py_files = []
    for dirpath, _, filenames in os.walk(_SRC_DIR):
        for name in filenames:
            if name.endswith(".py"):
                full = os.path.join(dirpath, name)
                rel  = os.path.relpath(full, _REPO_ROOT)  # e.g. "src/MasterClass.py"
                py_files.append((full, rel))

    py_files.sort(key=lambda t: t[1])

    with zipfile.ZipFile(_OUT_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for full, rel in py_files:
            zf.write(full, arcname=rel)

    size_kb = os.path.getsize(_OUT_PATH) / 1024
    print(f"wrote {_OUT_PATH} ({len(py_files)} files, {size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
