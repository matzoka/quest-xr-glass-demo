# Quest XR 地球デモ

宇宙空間に浮かぶ部屋の中の地球を、手（コントローラー）で触れて弾くデモです。
弾かれた地球は直線に飛び、部屋の壁・床で跳ね返り続けます。地球はゆっくり自転し、
雲のレイヤーが地表とは別の速度で流れます。可視の太陽方向から昼夜を計算し、夜側だけに
主要都市ライトとオーロラが出ます。人工衛星（ISS風）は地球を周回し、夜側では暗くなります。
月・火星・金星・木星・土星本体にも太陽方向に合わせた陰影が入り、木星にはガリレオ衛星風の小衛星、
土星にはタイタンなどの小衛星が公転します。これらの小衛星にはNASA / USGS / JPL由来の全球モザイク画像を
1024pxテクスチャとして貼り、太陽方向に合わせた昼夜の陰影も出しています。太陽ではフレア、
プロミネンス、黒点が一定期間だけ発生します。
土星リングは、半径方向だけの高解像度CanvasTextureで濃淡と隙間をはっきり見せます。
リングには太陽方向の明暗と土星本体の影も入ります。

USS Enterprise風の宇宙船は地球の部屋枠を通過した後、何もない宇宙空間へ向けてワープし、
ワープ音の終わりに船体・航跡・前方スパークが同時に消えます。低確率では地球近くを周回する
レア演出もあります。小型隕石は多くが大気圏で燃え尽き、夜側では浅い角度の流れ星として見えます。
遠方では彗星が地球に衝突しない背景演出として通過し、地表ではランダムに稲光が光ります。
月（大きさは地球の約1/4という実物どおりのサイズ比）が、地球の周りを周回します。さらに、
東京とロサンゼルスを結ぶ小さな旅客機が地表を飛び交います。Meta Quest 3 の VR / AR で動作します。
まれにクリンゴン船がクローク解除風に現れ、暗い背景側を重く通過してから緑の発光とともに消えます。
このクリンゴン演出では `assets/klingon_theme.mp3` を再生し、音声の約29秒の尺に合わせて通過速度を調整しています。

Three.js + WebXR で動作します。

## 操作方法

### Quest（VR / AR）

- 「Enter VR」または「Enter AR」を押してセッションを開始します。
- コントローラー（手）を地球に近づけて**触れる**と、その方向へ弾けます。速く動かすほど速く飛びます。
- 離れた位置にある地球は、**トリガー**を引くとコントローラーの指した方向へ発射できます。
- **スティックを倒すと、その方向へ滑らかに移動**できます（地球や、遠くの月に近づけます）。
- VR/AR 中は、目の前に出る**「終了」ボタンをコントローラーで指してトリガー**を引くと退出できます。
- 地球は一定速度で直線移動し、部屋の壁・床で跳ね返り続けます。再び触れると進路が変わります。
- 目の前に出る**「Enterprise 周回」ボタン**を指してトリガーを引くと、Enterprise風宇宙船の地球周回レア演出を手動で開始 / 予約できます。
- 目の前に出る**「クリンゴン登場」ボタン**を指してトリガーを引くと、クリンゴン船の通過演出を手動で開始 / 予約できます。

### PC（動作確認用プレビュー）

WebXR 非対応のデスクトップブラウザでも、3D プレビューで動きを確認できます。

- `W` / `A` / `S` / `D` または 矢印キー … 前後左右に弾く（視点基準）
- `E` または `Space` … 上に弾く ／ `Q` … 下に弾く
- クリック … 視線方向へ発射
- 左上HUDの `Enterprise 周回` … Enterprise風宇宙船の地球周回レア演出を手動で開始 / 予約
- 左上HUDの `クリンゴン登場` … クリンゴン船の通過演出を手動で開始 / 予約

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
- `app.js` … シーン構築・物理（直線移動と反射）・入力処理・地球の自転、雲、太陽方向に基づく惑星陰影の制御
- `styles.css` … HUD のスタイル
- `assets/earth_atmos_2048.jpg` … 地表テクスチャ（three.js サンプル / NASA 由来）
- `assets/earth_clouds_2048.png` … 雲テクスチャ（同上、透過マップとして使用）
- `assets/moon_1024.jpg` … 月テクスチャ（同上）
- `assets/2k_sun.jpg` … 太陽テクスチャ
- `assets/2k_mars.jpg` / `assets/2k_venus_atmosphere.jpg` / `assets/2k_jupiter.jpg` … 火星・金星・木星テクスチャ
- `assets/2k_saturn.jpg` … 土星本体テクスチャ。リングの濃淡と太陽方向の陰影は `app.js` 内でCanvasTextureとShaderMaterialとして生成します。
- `assets/moon_io_1024.jpg` / `assets/moon_europa_1024.jpg` / `assets/moon_ganymede_1024.jpg` / `assets/moon_callisto_1024.jpg` … 木星のガリレオ衛星用テクスチャ
- `assets/moon_titan_1024.jpg` / `assets/moon_rhea_1024.jpg` / `assets/moon_dione_1024.jpg` / `assets/moon_enceladus_1024.jpg` … 土星の小衛星用テクスチャ
- `assets/NCC-1701/` … Enterprise風宇宙船のOBJ / MTLモデルとテクスチャ一式
- `assets/enterprise_theme.mp3` … Enterprise風宇宙船の登場時に再生する音声
- `assets/warp.mp3` … Enterprise風宇宙船のワープ時に再生する音声
- `assets/star-trek-viewer.mp3` … Enterprise風宇宙船のレア周回中に再生するBGM
- `assets/klingon_theme.mp3` … クリンゴン船の通過時に再生するBGM
- `assets/star-trek-tng-transporter.mp3` … クリンゴン船の出現時に再生する効果音
- `assets/star-trek-transportation.mp3` … クリンゴン船の消滅時に再生する効果音
- `assets/klingon_ship/` … 現行のクリンゴン船OBJ / MTLモデル一式
- `inspect.html` / `inspect.js` … 現行クリンゴン船モデルを単体確認するための検査ビュー
- `_headers` … 静的ホスト用のMIME設定とCOOP / COEPヘッダー設定

## 調整できるところ（`app.js`）

- `roomCenter` / `roomHalf` … 部屋の位置とサイズ（中心からの半径）
- `EARTH_RADIUS` … 地球の大きさ
- `EARTH_SPIN` / `CLOUD_SPIN` … 自転の速さと、雲が流れる速さ（rad/秒）
- `CRUISE_DEFAULT` / `MIN_KICK` / `MAX_KICK` / `HAND_GAIN` … 弾く速度と手の感度

## テクスチャとモデルについて

地球、雲、月、太陽、火星、金星、木星、土星のテクスチャは `assets/` に同梱しています。
外部画像CDNに依存しないため、オフラインやCORS制限のある環境でもそのまま表示できます。

Enterprise風宇宙船は `assets/NCC-1701/` のOBJ / MTLモデルを読み込み、クリンゴン船は
`assets/klingon_ship/` の `klingon_ship.obj` / `klingon_ship.mtl` を読み込みます。
現在のアプリでは、`assets/klingon_ship/` 以外のクリンゴン船フォルダは参照していません。

初期版のガラス球モデル（`assets/glass_demo.glb`）と生成スクリプト
（`../scripts/create_quest_mr_glass_demo.py`）は、地球版では使用しませんが参考として
残しています。

## エンタープライズ号の登場音楽

登場時には、オリジナルの合成ファンファーレが鳴ります。ブラウザの自動再生制限のため、
**最初に一度、画面のクリックやコントローラー操作で音声を有効化**してください。

お好みの音源に差し替える場合は、MP3 を **`assets/enterprise_theme.mp3`** という名前で
置いてください。ファイルがあればそちらの冒頭が登場中に再生され、画面から消えると停止します
（無ければ合成ファンファーレにフォールバック）。別のファイル名にしたい場合は `app.js` 内の
Enterprise音声読み込みパスを編集してください。

ワープ時は **`assets/warp.mp3`** を再生し、音声の終了タイミングに合わせて船体、航跡、
前方スパークを同時に消します。レア周回演出では、地球周回に入っている間だけ
**`assets/star-trek-viewer.mp3`** を再生します。

> 楽曲の著作権は利用者の責任で確認してください。実在のテーマ曲などは権利者の許諾が必要な
> 場合があります。

## クリンゴン船のBGM

クリンゴン演出では **`assets/klingon_theme.mp3`** を Web Audio で読み込みます。
音声を読み込めた場合はMP3の実際の長さに合わせて通過演出の時間を決め、読み込めない場合でも
約29秒のフォールバック尺で表示します。Enterpriseの通常/レア演出とは同時に発生しないよう、
排他制御しています。

また、出現時には **`assets/star-trek-tng-transporter.mp3`**、消滅時には
**`assets/star-trek-transportation.mp3`** を一回再生します。消滅音は船体のフェードアウト終盤に
重なるよう、音声の長さに応じて少し早めに鳴らします。
