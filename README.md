# Quest XR 地球デモ

宇宙空間に浮かぶ部屋の中の地球を、手（コントローラー）で触れて弾くと、
直線に飛んで壁・床で跳ね返る Meta Quest 3 向けの WebXR デモです。
地球はゆっくり自転し、雲のレイヤーが地表とは別の速度で流れます。
表示と物理（直線移動＋反射）は Three.js / WebXR で動かしています。

## リポジトリ構成

- `quest-mr/` … WebXR ビューア本体（Three.js）。このフォルダを HTTPS 静的ホストに公開すると Quest で動かせます。詳細は [quest-mr/README.md](quest-mr/README.md)。
- `scripts/` … Blender 用 Python スクリプト（初期版でガラス球モデルを生成したもの。地球版では未使用ですが、参考として残しています）。

## 操作方法

### Quest（VR / AR）

- 「Enter VR」または「Enter AR」を押してセッションを開始します。
- コントローラー（手）を地球に近づけて**触れる**と、その方向へ弾けます。速く動かすほど速く飛びます。
- 離れた位置の地球は、**トリガー**を引くとコントローラーの指した方向へ発射できます。地球は直線移動し、壁・床で跳ね返り続けます。

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

調整できるパラメータなど、詳しくは
[quest-mr/README.md](quest-mr/README.md) を参照してください。

## GitHub Pages で公開する

このリポジトリは GitHub Pages での公開に対応しています。リポジトリのルートに
ある [index.html](index.html) が `quest-mr/` へ自動リダイレクトするため、
リポジトリ全体をそのまま Pages として配信できます。

1. GitHub の **Settings → Pages** を開きます。
2. **Build and deployment** の **Source** を「Deploy from a branch」にします。
3. **Branch** を `master`、フォルダを `/ (root)` に設定して **Save** します。
4. 数分待つと、以下の URL で公開されます（HTTPS 配信なので Quest でそのまま動きます）。

   https://matzoka.github.io/quest-xr-glass-demo/

ルートにアクセスすると `quest-mr/` へリダイレクトされます。直接
https://matzoka.github.io/quest-xr-glass-demo/quest-mr/ を開いても構いません。
この URL を Quest Browser で開き、「Enter VR」または「Enter AR」を押します。
