# Sales Compass 案件受付票

iPhone Safariで開き、ホーム画面へ追加して使うための空の案件受付票フォームです。

## 公開範囲

このリポジトリに含めるものは、空の入力フォームだけです。

- `index.html`
- `README.md`
- `.gitignore`
- `scripts/`
- `tests/`

顧客情報、案件情報、受付票画像、`customers`、`cases`、`incoming`、社員カルテ、内部設計書は含めません。

## セキュリティ方針

- 外部ライブラリ、CDN、外部通信は使いません
- 入力内容をLocalStorage、Cookie、サーバーへ保存しません
- 入力データを外部へ送信しません
- 入力後の情報は、利用者が端末上でスクリーンショットとして扱います
- 顧客データ、案件データ、添付資料はGitHub Pagesへ保存しません

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

必要に応じて「受付JSONを保存」を押すと、後段のLEON処理へ渡すJSONを端末へ保存できます。

## Phase2 Customer & Case Management

GitHub Pagesは静的サイトのため、ブラウザからローカルの`customers/`フォルダを直接生成しません。

Phase2では以下の構成を採用します。

1. iPhone Safariの受付票から受付JSONを保存する
2. ローカル環境でCLIを実行する
3. CLIがCustomer検索、ID発番、フォルダ生成、JSON保存、LEON返却文生成を行う

### 入力JSON

```json
{
  "received_date": "2026-07-22",
  "contact_type": "訪問",
  "customer_name": "H鉄工所",
  "industry": "製造業",
  "consultation": "工場内Wi-Fiの通信が不安定",
  "expected_attachments": [
    "ネットワーク構成図",
    "平面図"
  ]
}
```

### ローカル処理

```sh
node scripts/process-intake.mjs --input path/to/intake.json --root .
```

`--root`で指定した場所に`customers/`を作成します。

生成例:

```text
customers/
└── CUS-000001_H鉄工所/
    ├── customer.json
    └── cases/
        └── CASE-20260722-001/
            ├── intake/
            ├── attachments/
            ├── research/
            ├── tasks/
            └── case.json
```

### Customer判定

- `EXACT_MATCH`: 正規化後の顧客名が完全一致。既存Customerへ案件追加。
- `POSSIBLE_MATCH`: 法人格表記の違いなどで類似候補あり。自動登録せず停止。
- `NEW_CUSTOMER`: 一致なし。新規Customerを登録。

曖昧一致だけでは同一顧客として確定しません。

### ID発番

- Customer ID: `CUS-000001`形式。既存最大値+1。
- Case ID: `CASE-YYYYMMDD-001`形式。受付日ごとに既存最大値+1。
- 削除済みIDは再利用しません。

### 安全性

- `customers/.sales-compass-lock`で同時実行時のID重複を防止します。
- JSONは一時ファイルへ保存後、正常完了時に置換します。
- 新規Customerと新規Caseは一時フォルダで作成後、最後に正式フォルダへ移動します。
- 顧客データ、案件データ、添付資料は`.gitignore`で除外します。

### テスト

```sh
node tests/customer-case-management.test.mjs
```

## GitHub Pages

GitHub Pagesは、リポジトリの `main` ブランチ、ルートディレクトリから公開する想定です。

公開URLの例:

```text
https://<github-user>.github.io/sales-compass-case-intake/
```

## 注意

このフォームは営業フェーズ、必要部署、必要成果物、次回アクションを入力させません。これらはSales CompassのLEONが受付後に判断します。
