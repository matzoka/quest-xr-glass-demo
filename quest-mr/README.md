# Quest XR ガラス球デモ

宇宙空間に浮かぶ部屋の中のガラス球を、手（コントローラー）で触れて弾くデモです。
弾かれた球は直線に飛び、部屋の壁・床で跳ね返り続けます。Meta Quest 3 の VR / AR
で動作します。

Three.js + WebXR で動作し、球の3Dモデルは Blender で生成しています。

## 操作方法

### Quest（VR / AR）

- 「Enter VR」または「Enter AR」を押してセッションを開始します。
- コントローラー（手）を球に近づけて**触れる**と、その方向へ球が弾けます。速く動かすほど速く飛びます。
- 離れた位置にある球は、**トリガー**を引くとコントローラーの指した方向へ発射できます。
- 球は一定速度で直線移動し、部屋の壁・床で跳ね返り続けます。再び触れると進路が変わります。

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

同梱の `_headers` は、Netlify 形式のヘッダーに対応するホスト向けに `.glb` の
MIME タイプを設定するためのものです。

## ファイル構成

- `index.html` … エントリーポイント（Three.js を CDN から読み込み）
- `app.js` … シーン構築・物理（直線移動と反射）・入力処理の本体
- `styles.css` … HUD のスタイル
- `assets/glass_demo.glb` … ガラス球の 3D モデル（Blender で生成）
- `_headers` … 静的ホスト用の MIME 設定

## 調整できるところ（`app.js`）

- `roomCenter` / `roomHalf` … 部屋の位置とサイズ（中心からの半径）
- `CRUISE_DEFAULT` / `MIN_KICK` / `MAX_KICK` / `HAND_GAIN` … 球の飛ぶ速度と手の感度
- `glassModel.scale.setScalar(0.82)` … 球の見かけの大きさ

## 球モデルの再生成

球の `.glb` は、リポジトリルートの `scripts/create_quest_mr_glass_demo.py` を
Blender で実行すると再生成されます（Blender MCP 経由、または Blender の
スクリプトエディタから実行）。
