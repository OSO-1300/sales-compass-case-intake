# Sales Compass 案件受付票

iPhone Safariで開き、ホーム画面へ追加して使うための空の案件受付票フォームです。

## 公開範囲

このリポジトリに含めるものは、空の入力フォームだけです。

- `index.html`
- `README.md`
- `.gitignore`

顧客情報、案件情報、受付票画像、`customers`、`cases`、`incoming`、社員カルテ、内部設計書は含めません。

## セキュリティ方針

- 外部ライブラリ、CDN、外部通信は使いません
- 入力内容をLocalStorage、Cookie、サーバーへ保存しません
- 入力データを外部へ送信しません
- 入力後の情報は、利用者が端末上でスクリーンショットとして扱います

## iPhoneでの使い方

1. GitHub Pagesの公開URLをSafariで開く
2. 共有ボタンを押す
3. 「ホーム画面に追加」を選ぶ
4. ホーム画面のアイコンから案件受付票を開く
5. 応対日、応対種別、顧客名、業種、相談内容を入力する
6. 必要に応じて回答期限、緊急度、添付資料を入力する
7. 「受付票を表示」を押す
8. 表示された受付票をスクリーンショットする
9. スクリーンショット画像と添付資料をSales Compassのincomingへ渡す

## GitHub Pages

GitHub Pagesは、リポジトリの `main` ブランチ、ルートディレクトリから公開する想定です。

公開URLの例:

```text
https://<github-user>.github.io/sales-compass-case-intake/
```

## 注意

このフォームは営業フェーズ、必要部署、必要成果物、次回アクションを入力させません。これらはSales CompassのLEONが受付後に判断します。
