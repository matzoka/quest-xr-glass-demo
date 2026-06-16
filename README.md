# Quest XR ガラス球デモ

宇宙空間に浮かぶ部屋の中のガラス球を、手（コントローラー）で触れて弾くと、
直線に飛んで壁・床で跳ね返る Meta Quest 3 向けの WebXR デモです。
球の 3D モデルは Blender で生成し、表示と物理（直線移動＋反射）は
Three.js / WebXR で動かしています。

## リポジトリ構成

- `quest-mr/` … WebXR ビューア本体（Three.js）。このフォルダを HTTPS 静的ホストに公開すると Quest で動かせます。詳細は [quest-mr/README.md](quest-mr/README.md)。
- `scripts/` … Blender 用 Python スクリプト。`create_quest_mr_glass_demo.py` がガラス球モデル `glass_demo.glb` を生成します。

## 操作方法

### Quest（VR / AR）

- 「Enter VR」または「Enter AR」を押してセッションを開始します。
- コントローラー（手）を球に近づけて**触れる**と、その方向へ球が弾けます。速く動かすほど速く飛びます。
- 離れた位置の球は、**トリガー**を引くとコントローラーの指した方向へ発射できます。
- 球は一定速度で直線移動し、部屋の壁・床で跳ね返り続けます。再び触れると進路が変わります。

### PC（動作確認用プレビュー）

- `W` / `A` / `S` / `D` または矢印キー … 前後左右に弾く（視点基準）
- `E` または `Space` … 上に弾く ／ `Q` … 下に弾く
- クリック … 視線方向へ発射

## ローカルで確認する（デスクトップ）

任意の静的 HTTP サーバーで `quest-mr` フォルダを配信します。例:

```
npx http-server quest-mr -p 4321 -c-1
```

ブラウザで http://localhost:4321 を開きます。デスクトップでは WebXR は使えませんが、
上記のキーボード／クリック操作で動作を確認できます。

## Quest 実機で見る

Quest の AR / VR セッションは **HTTPS（セキュアコンテキスト）が必須**です。
`quest-mr/` フォルダの中身をサイトのルートとして、HTTPS 対応の静的ホスト
（Netlify / Cloudflare Pages / GitHub Pages など）に公開してください。
公開した URL を Quest Browser で開き、「Enter VR」または「Enter AR」を押します。

デプロイ手順・調整できるパラメータ・球モデルの再生成方法など、詳しくは
[quest-mr/README.md](quest-mr/README.md) を参照してください。
