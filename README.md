# Weather Viewer

気象庁データを可視化する静的Webアプリです。UIは EQ-app-2026 に近いダークテーマを目標にしています。

## 初期機能

- 雨雲レーダー
- アメダス
- 気象注意報・警報・特別警報の市区町村別地図表示
- 台風情報

## 方針

- バックエンドサーバーは使わない
- ブラウザの `fetch` で気象庁データを取得する
- 地図はまず Leaflet + 地理院地図で構築する
- 後で EQ-app-2026 の日本地図データや市区町村GeoJSONに置き換える

## 開発

```bash
npm install
npm run dev
```

## GitHub Pages へのデプロイ

このアプリは GitHub Actions で `npm run build` を実行し、生成された `dist` を GitHub Pages に公開します。

1. GitHub のリポジトリ設定で `Settings` → `Pages` を開く
2. `Build and deployment` の `Source` を `GitHub Actions` にする
3. `main` ブランチへ push する

公開URLは通常、以下の形式になります。

```text
https://wvdtc7bjwn-bit.github.io/Weather-viewer/
```

GitHub Actions 上では Vite の `base` を `/Weather-viewer/` にしてビルドします。ローカル開発時はこれまで通り `/` で動作します。

## 次にやること

1. 雨雲レーダーの実タイル表示
2. アメダス地点一覧と観測値表示
3. 市区町村GeoJSONの追加
4. 警報・注意報データと市区町村コードの対応
5. 台風進路・予報円描画

## 注意

JMAの一部データはURL変更やCORS制約の影響を受ける可能性があります。ブラウザから直接取得できないデータがあった場合は、Cloudflare WorkersやPages Functionsなどの軽量プロキシを検討します。
