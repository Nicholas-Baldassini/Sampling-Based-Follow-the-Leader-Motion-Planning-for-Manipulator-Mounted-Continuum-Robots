"""
One-off shape library generator for the static demo site.

Generates the libraries the website ships with (`docs/assets/shape_lib_*.json`)
using the same robot configuration as `run_example.py`. Re-run any time the
robot parameters change. The output format is the same one
`GeneralMotionPlanner.load_custom_shape_library` expects, but with whitespace
stripped and floats rounded to 5 decimals to keep file sizes manageable for
shipping over GitHub Pages.

Usage:
    python tools/generate_shape_libs.py             # default: 5k + 10k libs
    python tools/generate_shape_libs.py --sizes 1000 5000
"""

import argparse
import json
import os
import sys
import time

import numpy as np

# Make `src` importable when running this script directly from the repo root.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from src.MasterClass import GeneralPathFollower  # noqa: E402
from src.RobotModels.ConstantCurvatureModel import ConstantCurvature  # noqa: E402


# Robot config matches run_example.py.
ROBOT_KWARGS = dict(
    num_segments=3,
    segment_lengths=[1, 1, 1],
    tendon_offset=[0.2, 0.2, 0.2],
    points_resolution=0.05,
)


def _round_floats(obj, decimals: int):
    if isinstance(obj, np.ndarray):
        return np.round(obj, decimals).tolist()
    if isinstance(obj, (list, tuple)):
        return [_round_floats(x, decimals) for x in obj]
    if isinstance(obj, (np.floating, float)):
        return round(float(obj), decimals)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj


def save_compact(shape_library, num_segments: int, output_path: str, decimals: int = 5):
    """Compact-JSON dump (no whitespace, rounded floats)."""
    shapes = []
    for s in shape_library:
        shapes.append({
            "clark_coords":          _round_floats(s["clark_coords"], decimals),
            "shape_points":          _round_floats(s["shape_points"], decimals),
            "endpoints":             _round_floats(s["endpoints"], decimals),
            "tip_position":          _round_floats(s["tip_position"], decimals),
            "arc_length":            _round_floats(s["arc_length"], decimals),
            "arc_length_cumulative": _round_floats(s["arc_length_cumulative"], decimals),
        })
    payload = {
        "meta": {"num_tendons": 3, "num_segments": num_segments},
        "shapes": shapes,
    }
    with open(output_path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))


def generate(num_samples: int, output_path: str, seed: int = 42):
    print(f"\n[gen] {num_samples} shapes -> {output_path}")
    robot = ConstantCurvature(**ROBOT_KWARGS)
    follower = GeneralPathFollower(robot)
    t0 = time.perf_counter()
    sampler = follower.get_sampling_threshold_cluster(
        num_samples=num_samples,
        random_seed=seed,
        verbose=False,
    )
    print(f"[gen] generated in {time.perf_counter() - t0:.2f}s")
    save_compact(sampler.shape_library, ROBOT_KWARGS["num_segments"], output_path)
    size_mb = os.path.getsize(output_path) / 1_048_576
    print(f"[gen] wrote {size_mb:.1f} MB")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sizes",
        type=int,
        nargs="+",
        default=[5_000, 10_000],
        help="Library sizes to generate.",
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.join(_REPO_ROOT, "docs", "assets"),
        help="Where to write the shape_lib_<n>k.json files.",
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    for ns in args.sizes:
        if ns % 1000 == 0:
            label = f"{ns // 1000}k"
        else:
            label = str(ns)
        out_path = os.path.join(args.out_dir, f"shape_lib_{label}.json")
        generate(ns, out_path, seed=args.seed)


if __name__ == "__main__":
    main()
