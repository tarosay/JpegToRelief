# JpegToRelief

日本語 | **English below**

---

## 📸 日本語版

このリポジトリは **JPEG / PNG 画像から背面照明用の凹凸（高さ）パネルを生成するためのツール**です。

カラー画像を輝度情報に変換し、  
**物理的に意味のある凹凸形状（厚み）として出力**します。

これは単なるモノトーン→高さマップ変換ではなく、  
**光の透過量を考えた設計と出力**を行うものです。

### 🔧 特徴

- **sRGB → リニアRGB → 輝度（Y）** に変換（ガンマ補正を除去）
- 出力形式:
  - **16bit PNG**（高さマップの可視化）
  - **.npy**（mm単位の実厚みデータ）
  - **.stl**（3Dモデル）
- 向きの制御（PNG / NPY / STL が常に一致）
  - `--flip-x` : 左右反転
  - `--flip-y` : 上下反転
  - `--rot180` : 180°回転
- 出力は **入力画像と同じフォルダ**

### 🛠 必要なライブラリ

```bash
pip install pillow numpy trimesh
```

### 🚀 使い方

```bash
python make_relief.py -i input.jpg
```

#### 幅の指定（mm）

```bash
python make_relief.py -i input.jpg --width-mm 200
```

#### 左右反転

```bash
python make_relief.py -i input.png --flip-x
```

#### 上下反転

```bash
python make_relief.py -i input.png --flip-y
```

#### 180°回転

```bash
python make_relief.py -i input.png --rot180
```

#### 高解像度出力

```bash
python make_relief.py -i input.png --width-mm 1000 --px 3000
```

### 📁 出力例

```
input_W100mm_height_16bit.png
input_W100mm_height_mm.npy
input_W100mm.stl
```

---

## 📘 English Version

This repository provides a tool to convert **JPEG / PNG images into backlit relief panels**.

A color image is converted into physical luminance-based thickness and exported as:
- a 16‑bit heightmap,
- raw thickness data,
- and a solid STL model.

This is not a simple grayscale-to-height conversion, but a **physically consistent luminance-to-thickness mapping**.

### 🔧 Features

- Converts **sRGB → Linear RGB → Luminance (Y)**
- Outputs:
  - **16‑bit PNG** (visual heightmap)
  - **.npy** (actual thickness in mm)
  - **.stl** (solid 3D model)
- Orientation control (PNG / NPY / STL always match):
  - `--flip-x` : flip left-right
  - `--flip-y` : flip up-down
  - `--rot180` : rotate 180°
- Outputs are written **next to the input image**

### 📦 Dependencies

```bash
pip install pillow numpy trimesh
```

### 🚀 Usage

```bash
python make_relief.py -i input.jpg
```

#### Specify Physical Width (mm)

```bash
python make_relief.py -i input.jpg --width-mm 200
```

#### Flip Left–Right

```bash
python make_relief.py -i input.png --flip-x
```

#### Flip Up–Down

```bash
python make_relief.py -i input.png --flip-y
```

#### Rotate 180°

```bash
python make_relief.py -i input.png --rot180
```

#### High‑Resolution Output

```bash
python make_relief.py -i input.png --width-mm 1000 --px 3000
```

### 📁 Example Outputs

```
input_W100mm_height_16bit.png
input_W100mm_height_mm.npy
input_W100mm.stl
```

---

## 📌 Notes

- Thickness-to-transmission characteristics depend on the material.
- Final appearance depends on light source, diffusion, and viewing direction.
- For production, material calibration is recommended.

---

MIT License  
© tarosay
