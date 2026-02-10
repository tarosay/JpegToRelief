# JpegToRelief

日本語 | **English below**

---

## 🇯🇵 日本語

**JpegToRelief** は、画像（JPEG / PNG 等）から  
**背面照明用の透過リリーフ（厚み分布）を生成するツール**です。

- Python CLI ツール
- ブラウザだけで動作する Web アプリ（GitHub Pages）

の **2系統**を提供します。

本ツールは単なる「モノクロ → 高さマップ」ではなく、

- sRGB ガンマを除去
- 線形輝度（Luminance Y）で評価
- **明るい部分ほど薄く（Bright = Thin）** なる厚み設計

という **物理的に一貫した透過設計**を前提としています。

---

## 🌐 Web アプリ（GitHub Pages）

👉 **https://tarosay.github.io/JpegToRelief/**

### 特徴

- 画像を **ドラッグ＆ドロップ**
- ブラウザ内だけで処理（サーバ送信なし）
- STL をそのままダウンロード
- プレビューと STL の向きは常に一致

### Web 版でできること

- Bright = Thin / Bright = Thick の切り替え（Invert）
- Black / White cut による輝度クリップ
- トーンカーブ（gamma）調整
- 左右反転 / 上下反転 / 180°回転
- mm 単位での物理幅指定

---

## 🐍 Python CLI 版

### 必要なライブラリ

```bash
pip install pillow numpy trimesh
```

### 基本的な使い方（Bright = Thin がデフォルト）

```bash
python make_relief.py -i input.jpg
```

### Bright = Thick にしたい場合

```bash
python make_relief.py -i input.jpg --no-invert
```

### 主なオプション

| オプション | 内容 |
|-----------|------|
| `--width-mm` | 出力物の物理幅（mm） |
| `--px` | 処理解像度（横ピクセル数） |
| `--base-mm` | ベース板厚 |
| `--relief-mm` | 凹凸の最大高さ |
| `--invert / --no-invert` | Bright=Thin / Bright=Thick |
| `--flip-x` | 左右反転 |
| `--flip-y` | 上下反転 |
| `--rot180` | 180°回転 |
| `--black / --white` | 輝度クリップ |
| `--tone` | トーンガンマ |

---

## 📦 出力ファイル

```
input_W100mm_height_16bit.png   # 正規化した高さ（確認用）
input_W100mm_height_mm.npy     # 実際の厚み（mm）
input_W100mm.stl               # ソリッド STL
```

- STL は **底面 z=0、上面が厚み形状**
- 側面を含む完全なソリッドモデルです

---

## 💡 設計思想（重要）

### なぜ Bright = Thin なのか？

背面照明では：

- **薄い → 明るく透過**
- **厚い → 暗く遮光**

となるため、画像の見た目を再現するには

> **明るい画素ほど薄く、暗い画素ほど厚く**

する必要があります。  
本ツールはこれを **デフォルト挙動**としています。

---

## ⚠ 注意事項

- 透過特性は **材料（PLA / PETG / アクリル等）** に依存します
- 実運用では、
  - 材料
  - 光源
  - 拡散距離
  - ベース板厚
  を含めた **実測調整**を推奨します
- 大サイズはまず小さくテストしてください

---

## 📄 License

MIT License  
© tarosay

---

## 🇺🇸 English

**JpegToRelief** converts images (JPEG / PNG) into  
**thickness‑based relief panels for backlit illumination**.

It provides:

- a Python CLI tool
- a fully client‑side Web app (GitHub Pages)

The core idea is **physically consistent transmission design**:

- remove sRGB gamma
- evaluate linear luminance (Y)
- **Bright = Thin (default)** for backlit appearance

---

## 🌐 Web App

👉 **https://tarosay.github.io/JpegToRelief/**

- Drag & drop image
- Runs 100% in your browser
- No upload, no server
- Download STL directly

---

## 🐍 Python CLI

```bash
python make_relief.py -i input.jpg
```

Bright = Thick version:

```bash
python make_relief.py -i input.jpg --no-invert
```

---

## 📦 Outputs

- 16‑bit PNG (preview)
- `.npy` thickness data (mm)
- solid `.stl` model

---

## 📐 Philosophy

For backlit panels:

- thinner → brighter
- thicker → darker

Therefore **Bright = Thin** is the correct default mapping.

---

MIT License  
© tarosay
