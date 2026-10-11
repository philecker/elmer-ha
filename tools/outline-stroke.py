"""Convert the stroked brand mark into one filled path.

Reads {"weight": float, "shapes": [...]} on stdin and writes {"d", "area"}.

Each shape is flattened to a polyline, buffered by half the stroke weight with
round caps and joins — which is what the mark is drawn with — and the union of
those buffers is the filled outline. Holes come back as interior rings; they
are emitted wound opposite to their exterior so the default nonzero fill rule
cuts them out, since the icon is rendered as a bare <path> with no fill-rule
of its own to set.
"""

from __future__ import annotations

import json
import sys

from shapely.geometry import LineString
from shapely.ops import unary_union
from svgpathtools import parse_path

# Enough segments that a curve is smooth at the size a sidebar icon is read,
# without padding the path data with points nobody can see.
SEGMENTS = 64

# The buffer returns far more points than a 24-unit glyph can show. This file
# is fetched on every Home Assistant page, so the path is thinned to the point
# where the error is well under a pixel: 0.01 of a 24-unit box is a fortieth
# of a pixel at the 24px the sidebar draws it, and a hundredth at the 120px of
# the panel header.
TOLERANCE = 0.01


def polyline(d: str) -> list[list[tuple[float, float]]]:
    """A path's subpaths, each as a list of points."""
    out = []
    for sub in parse_path(d).continuous_subpaths():
        pts = []
        for i in range(SEGMENTS + 1):
            p = sub.point(i / SEGMENTS)
            pts.append((round(p.real, 4), round(p.imag, 4)))
        out.append(pts)
    return out


def rounded_rect(x: float, y: float, w: float, h: float, r: float) -> str:
    """A rounded rectangle as path data, so rects and paths take one route."""
    r = min(r, w / 2, h / 2)
    return (
        f"M{x + r} {y}"
        f"H{x + w - r}A{r} {r} 0 0 1 {x + w} {y + r}"
        f"V{y + h - r}A{r} {r} 0 0 1 {x + w - r} {y + h}"
        f"H{x + r}A{r} {r} 0 0 1 {x} {y + h - r}"
        f"V{y + r}A{r} {r} 0 0 1 {x + r} {y}Z"
    )


def ring(points) -> str:
    """One closed ring as path data, at the precision an icon needs."""
    pts = list(points)
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    head = f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"
    rest = "".join(f"L{x:.2f} {y:.2f}" for x, y in pts[1:])
    return f"{head}{rest}Z"


def main() -> int:
    spec = json.load(sys.stdin)
    half = spec["weight"] / 2

    strokes = []
    for shape in spec["shapes"]:
        d = (
            shape["d"]
            if shape["kind"] == "path"
            else rounded_rect(shape["x"], shape["y"], shape["w"], shape["h"], shape["rx"])
        )
        for pts in polyline(d):
            strokes.append(
                LineString(pts).buffer(
                    half, cap_style="round", join_style="round", quad_segs=16
                )
            )

    merged = unary_union(strokes)
    thin = merged.simplify(TOLERANCE, preserve_topology=True)
    # Only if nothing was lost. preserve_topology keeps a shape valid, not
    # necessarily whole: a thin bridge can still be pinched off, which would
    # drop the latch or split the lid seam.
    if thin.is_valid and len(getattr(thin, "geoms", [thin])) == len(
        getattr(merged, "geoms", [merged])
    ):
        merged = thin

    polys = list(getattr(merged, "geoms", [merged]))

    parts = []
    for poly in polys:
        # Shapely does not promise a winding direction, and the nonzero rule
        # only cuts a hole out when the hole runs against its exterior.
        ext = poly.exterior
        parts.append(ring(ext.coords if ext.is_ccw else list(ext.coords)[::-1]))
        for inner in poly.interiors:
            parts.append(ring(list(inner.coords)[::-1] if inner.is_ccw else inner.coords))

    json.dump({"d": "".join(parts), "area": merged.area}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
