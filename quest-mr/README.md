# Quest XR 地球デモ

宇宙空間に浮かぶ部屋の中の地球を、手（コントローラー）で触れて弾くデモです。
弾かれた地球は直線に飛び、部屋の壁・床で跳ね返り続けます。地球はゆっくり自転し、
雲のレイヤーが地表とは別の速度で流れます。USS エンタープライズ風の宇宙船が周回し、
ときおり流れ星が落ちて地表で発火し、地表ではランダムに稲光が光ります。Meta Quest 3 の
VR / AR で動作します。

Three.js + WebXR で動作します。

## 操作方法

### Quest（VR / AR）

- 「Enter VR」または「Enter AR」を押してセッションを開始します。
- コントローラー（手）を地球に近づけて**触れる**と、その方向へ弾けます。速く動かすほど速く飛びます。
- 離れた位置にある地球は、**トリガー**を引くとコントローラーの指した方向へ発射できます。
- 地球は一定速度で直線移動し、部屋の壁・床で跳ね返り続けます。再び触れると進路が変わります。

### PC（動作確認用プレビュー）

WebXR 非対応のデスクトップブラウザでも、3D プレビューで動きを確認できます。

- `W` / `A` / `S` / `D` または 矢印キー … 前後左右に弾く（視点基準）
- `E` または `Space` … 上に弾く ／ `Q` … 下に弾く
- クリック … 視線方向へ発射

## ローカルで確認する（デスクトップ）

任意の静的 HTTP サーバーでこのフォルダを配信します。例:

```
npx http-server . -p 4321 -c-1
```

ブラウザで http://localhost:4321 を開きます。デスクトップでは WebXR は使えませんが、
上記のキーボード／クリック操作で動作を確認できます。

## Quest 実機で見る

Quest の AR / VR セッションは **HTTPS（セキュアコンテキスト）が必須**です。
この `quest-mr` フォルダの中身をサイトのルートとして、HTTPS 対応の静的ホスト
（Netlify / Cloudflare Pages / GitHub Pages など）に公開してください。

公開した URL を Quest Browser で開き、「Enter VR」または「Enter AR」を押します。

同梱の `_headers` は、Netlify 形式のヘッダーに対応するホスト向けに MIME タイプを
設定するためのものです。

## ファイル構成

- `index.html` … エントリーポイント（Three.js を CDN から読み込み）
- `app.js` … シーン構築・物理（直線移動と反射）・入力処理・地球の自転と雲の制御
- `styles.css` … HUD のスタイル
- `assets/earth_atmos_2048.jpg` … 地表テクスチャ（three.js サンプル / NASA 由来）
- `assets/earth_clouds_1024.png` … 雲テクスチャ（同上、`alphaMap` として使用）
- `_headers` … 静的ホスト用のヘッダー設定

## 調整できるところ（`app.js`）

- `roomCenter` / `roomHalf` … 部屋の位置とサイズ（中心からの半径）
- `EARTH_RADIUS` … 地球の大きさ
- `EARTH_SPIN` / `CLOUD_SPIN` … 自転の速さと、雲が流れる速さ（rad/秒）
- `CRUISE_DEFAULT` / `MIN_KICK` / `MAX_KICK` / `HAND_GAIN` … 弾く速度と手の感度

## テクスチャについて

地球と雲のテクスチャは three.js のサンプル（NASA Blue Marble 由来）を `assets/` に
同梱しています。外部 CDN に依存しないため、オフラインや CORS 制限のある環境でも
そのまま表示できます。

初期版のガラス球モデル（`assets/glass_demo.glb`）と生成スクリプト
（`scripts/create_quest_mr_glass_demo.py`）は、地球版では使用しませんが参考として
残しています。
