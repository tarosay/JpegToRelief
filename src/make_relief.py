#!/usr/bin/env python3
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import trimesh
except ImportError:
    trimesh = None


# Defaults
DEFAULT_WIDTH_MM = 100.0

TARGET_WIDTH_PX_DEFAULT = 600
BASE_THICK_MM_DEFAULT = 0.8
RELIEF_MM_DEFAULT = 1.5

BLACK_CUT_DEFAULT = 0.02
WHITE_CUT_DEFAULT = 0.98
TONE_GAMMA_DEFAULT = 1.15

# Bright=Thin is default (for backlit transmission)
INVERT_DEFAULT = True


def srgb_to_linear(srgb01: np.ndarray) -> np.ndarray:
    """sRGB (0..1) -> linear RGB (0..1)"""
    a = 0.055
    return np.where(
        srgb01 <= 0.04045,
        srgb01 / 12.92,
        ((srgb01 + a) / (1 + a)) ** 2.4
    )


def luminance_Y_from_linear_rgb(rgb_lin: np.ndarray) -> np.ndarray:
    """linear RGB -> relative luminance Y (Rec.709 / sRGB primaries)"""
    return (0.2126 * rgb_lin[..., 0] +
            0.7152 * rgb_lin[..., 1] +
            0.0722 * rgb_lin[..., 2])


def tone_map(Y: np.ndarray, black_cut: float, white_cut: float, tone_gamma: float) -> np.ndarray:
    """clip + gentle tone curve (works in linear luminance domain)"""
    if white_cut <= black_cut:
        raise ValueError("white_cut must be > black_cut")

    Yc = np.clip((Y - black_cut) / (white_cut - black_cut), 0.0, 1.0)

    # tone_gamma: 1.0 -> no change
    if abs(tone_gamma - 1.0) < 1e-12:
        return Yc
    return np.clip(Yc ** (1.0 / tone_gamma), 0.0, 1.0)


def apply_orientation(thickness_mm: np.ndarray, flip_x: bool, flip_y: bool, rot180: bool) -> np.ndarray:
    if rot180:
        flip_x = True
        flip_y = True

    if flip_x:
        thickness_mm = thickness_mm[:, ::-1]
    if flip_y:
        thickness_mm = thickness_mm[::-1, :]

    return thickness_mm.copy()


def make_thickness_mm(
    img_path: str,
    target_width_mm: float,
    target_width_px: int,
    base_thick_mm: float,
    relief_mm: float,
    black_cut: float,
    white_cut: float,
    tone_gamma: float,
    invert: bool,
    flip_x: bool,
    flip_y: bool,
    rot180: bool
) -> tuple[np.ndarray, float]:
    """
    Returns:
      thickness_mm: (H,W) float32, total thickness in mm (bottom z=0)
      px_mm: pixel size in mm
    """
    img = Image.open(img_path).convert("RGB")

    w, h = img.size
    target_h = int(round(h * (target_width_px / w)))
    img_r = img.resize((target_width_px, target_h), Image.Resampling.LANCZOS)

    rgb = np.asarray(img_r, dtype=np.float32) / 255.0
    rgb_lin = srgb_to_linear(rgb)
    Y = luminance_Y_from_linear_rgb(rgb_lin)
    Yt = tone_map(Y, black_cut, white_cut, tone_gamma)

    # Bright=Thin (invert) is the default for backlit transmission:
    # thickness = base + relief * (1 - Yt)
    # Otherwise (non-invert): thickness = base + relief * Yt
    v = (1.0 - Yt) if invert else Yt
    thickness_mm = base_thick_mm + relief_mm * v

    # Orientation is applied in array domain so PNG/NPY/STL always match
    thickness_mm = apply_orientation(thickness_mm, flip_x=flip_x, flip_y=flip_y, rot180=rot180)

    px_mm = float(target_width_mm) / float(target_width_px)
    return thickness_mm.astype(np.float32), px_mm


def save_heightmap(thickness_mm: np.ndarray, out_png16: Path, out_npy: Path):
    """Save normalized 16-bit PNG + raw mm values as .npy"""
    tmin = float(thickness_mm.min())
    tmax = float(thickness_mm.max())
    norm = (thickness_mm - tmin) / max(1e-9, (tmax - tmin))
    png16 = (norm * 65535.0 + 0.5).astype(np.uint16)

    Image.fromarray(png16, mode="I;16").save(str(out_png16))
    np.save(str(out_npy), thickness_mm)

    print(f"saved: {out_png16.name} , {out_npy.name} (in {out_png16.parent})")
    print(f"thickness range: {tmin:.3f} .. {tmax:.3f} mm")


def heightmap_to_stl(thickness_mm: np.ndarray, px_mm: float, out_stl: Path):
    """Create a solid STL: top surface=thickness_mm, bottom=0, with side walls."""
    if trimesh is None:
        raise RuntimeError("trimesh がありません。pip install trimesh してください。")

    H, W = thickness_mm.shape

    xs = np.arange(W, dtype=np.float32) * px_mm
    ys = np.arange(H, dtype=np.float32) * px_mm
    X, Y = np.meshgrid(xs, ys)
    Z = thickness_mm

    v_top = np.stack([X, Y, Z], axis=-1).reshape(-1, 3)
    v_bot = np.stack([X, Y, np.zeros_like(Z)], axis=-1).reshape(-1, 3)

    def idx(i, j):
        return i * W + j

    faces = []

    # Top faces
    for i in range(H - 1):
        for j in range(W - 1):
            a = idx(i, j)
            b = idx(i, j + 1)
            c = idx(i + 1, j)
            d = idx(i + 1, j + 1)
            faces.append([a, c, b])
            faces.append([b, c, d])

    # Bottom faces (reverse)
    offset = v_top.shape[0]
    for i in range(H - 1):
        for j in range(W - 1):
            a = offset + idx(i, j)
            b = offset + idx(i, j + 1)
            c = offset + idx(i + 1, j)
            d = offset + idx(i + 1, j + 1)
            faces.append([a, b, c])
            faces.append([b, d, c])

    top = lambda k: k
    bot = lambda k: offset + k

    # Side walls (perimeter)
    for j in range(W - 1):  # top edge i=0
        a, b = idx(0, j), idx(0, j + 1)
        faces += [[top(a), top(b), bot(a)], [top(b), bot(b), bot(a)]]
    for j in range(W - 1):  # bottom edge i=H-1
        a, b = idx(H - 1, j), idx(H - 1, j + 1)
        faces += [[top(b), top(a), bot(a)], [bot(a), bot(b), top(b)]]
    for i in range(H - 1):  # left edge j=0
        a, b = idx(i, 0), idx(i + 1, 0)
        faces += [[top(b), top(a), bot(a)], [bot(a), bot(b), top(b)]]
    for i in range(H - 1):  # right edge j=W-1
        a, b = idx(i, W - 1), idx(i + 1, W - 1)
        faces += [[top(a), top(b), bot(a)], [top(b), bot(b), bot(a)]]

    vertices = np.vstack([v_top, v_bot]).astype(np.float32)
    faces = np.asarray(faces, dtype=np.int64)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    mesh.export(str(out_stl))
    print(f"saved: {out_stl.name} (in {out_stl.parent})")


def resolve_out_base(in_path: Path, out_opt: str | None, width_mm: float) -> Path:
    """
    Output base path (without extension).
    Default: <input_dir>/<input_stem>_W<width_mm>mm
    If --out is given:
      - absolute path: use as-is (no extension expected)
      - relative path: resolve under input_dir
    """
    input_dir = in_path.parent
    if out_opt is None:
        return input_dir / f"{in_path.stem}_W{width_mm:g}mm"

    out_path = Path(out_opt)
    if out_path.is_absolute():
        return out_path
    return input_dir / out_path


def main():
    ap = argparse.ArgumentParser(
        description="Image -> linear luminance -> thickness relief -> STL (outputs next to input image)."
    )

    ap.add_argument("-i", "--in", dest="in_path", required=True,
                    help="Input image file (jpg/png/webp/...)")

    ap.add_argument("--width-mm", type=float, default=DEFAULT_WIDTH_MM,
                    help=f"Physical width in mm (default: {DEFAULT_WIDTH_MM:g})")

    ap.add_argument("--px", type=int, default=TARGET_WIDTH_PX_DEFAULT,
                    help=f"Output width in pixels (default: {TARGET_WIDTH_PX_DEFAULT})")
    ap.add_argument("--base-mm", type=float, default=BASE_THICK_MM_DEFAULT,
                    help=f"Base thickness in mm (default: {BASE_THICK_MM_DEFAULT})")
    ap.add_argument("--relief-mm", type=float, default=RELIEF_MM_DEFAULT,
                    help=f"Relief height in mm (default: {RELIEF_MM_DEFAULT})")

    ap.add_argument("--black", type=float, default=BLACK_CUT_DEFAULT,
                    help=f"Black cut (default: {BLACK_CUT_DEFAULT})")
    ap.add_argument("--white", type=float, default=WHITE_CUT_DEFAULT,
                    help=f"White cut (default: {WHITE_CUT_DEFAULT})")
    ap.add_argument("--tone", type=float, default=TONE_GAMMA_DEFAULT,
                    help=f"Tone gamma (1.0 = linear). default: {TONE_GAMMA_DEFAULT}")

    # Bright=Thin (invert) is default. Use --no-invert to make Bright=Thick.
    ap.add_argument("--invert", action=argparse.BooleanOptionalAction, default=INVERT_DEFAULT,
                    help="Invert mapping. Invert=ON: bright->thin (default). Invert=OFF: bright->thick.")

    ap.add_argument("--flip-x", action="store_true", help="Mirror left-right.")
    ap.add_argument("--flip-y", action="store_true", help="Mirror top-bottom.")
    ap.add_argument("--rot180", action="store_true", help="Rotate 180 deg (same as --flip-x --flip-y).")

    ap.add_argument("--out", default=None,
                    help="Output basename (no extension). "
                         "Default: <input_stem>_W<width_mm>mm. "
                         "Relative path is resolved under input image folder.")
    ap.add_argument("--no-stl", action="store_true",
                    help="Do not export STL (still exports PNG16 + NPY).")

    args = ap.parse_args()

    in_path = Path(args.in_path)
    if not in_path.exists():
        raise FileNotFoundError(str(in_path))

    out_base = resolve_out_base(in_path, args.out, args.width_mm)

    thickness_mm, px_mm = make_thickness_mm(
        img_path=str(in_path),
        target_width_mm=args.width_mm,
        target_width_px=args.px,
        base_thick_mm=args.base_mm,
        relief_mm=args.relief_mm,
        black_cut=args.black,
        white_cut=args.white,
        tone_gamma=args.tone,
        invert=args.invert,
        flip_x=args.flip_x,
        flip_y=args.flip_y,
        rot180=args.rot180
    )

    save_heightmap(thickness_mm,
                   out_base.with_name(out_base.name + "_height_16bit.png"),
                   out_base.with_name(out_base.name + "_height_mm.npy"))

    if not args.no_stl:
        heightmap_to_stl(thickness_mm, px_mm, out_base.with_suffix(".stl"))


if __name__ == "__main__":
    main()
