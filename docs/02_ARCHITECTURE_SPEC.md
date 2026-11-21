# 02. システム仕様・アーキテクチャ設計書 (Architecture & System Specification)

## 1. システム全体アーキテクチャ (Manifest V3)

本拡張機能は、Google Chromeの拡張機能仕様である **Manifest V3** に完全準拠して設計されます。

```
+------------------------------------------------------------------------+
|                             Google Chrome                              |
|                                                                        |
|  +--------------------+    +--------------------+    +---------------+ |
|  | Web Page (Tab)     |    | Side Panel         |    | Main Editor   | |
|  |                    |    | (sidepanel.html)   |    | (fulltab.html)| |
|  | +----------------+ |    | [Map Manager]      |    | [Full Canvas] | |
|  | | Content Script | |    | - マップ一覧・検索 |    | +-----------+ | |
|  | | - テキスト選択 | |    | - 新規マップ作成   |    | |MindMeister| | |
|  | | - 画像キャプチャ| |   | - Webクリップ先選択|    | |Engine     | | |
|  | +--------+-------+ |    | - ワンクリック展開 |    | |(画像・Link| | |
|  +----------|---------+    +--------|-----------+    +-------+-------+ |
|             |                       |                        |         |
|             | (Messages)            | (Open Tab / Events)    |         |
|             v                       v                        v         |
|  +------------------------------------------------------------------+  |
|  |             Background Service Worker (background.ts)            |  |
|  | - Context Menu (右クリック) 登録 & イベントハンドリング           |  |
|  | - サイドパネル開閉 & 全画面エディタタブ起動管理                  |  |
|  +----------------------------------+-------------------------------+  |
|                                     |                                  |
|                                     v                                  |
|  +------------------------------------------------------------------+  |
|  |             Data Layer (chrome.storage.local)                    |  |
|  | - "unlimitedStorage" 権限による大容量画像・マップツリー永続化     |  |
|  +------------------------------------------------------------------+  |
+------------------------------------------------------------------------+
```

---

## 2. ディレクトリ & ファイル構成

```text
mindmap-extension/
├── docs/                      # 設計書・仕様書・レビュー資料
├── public/
│   ├── icons/                 # 16px, 48px, 128px アイコン
│   └── manifest.json          # Manifest V3 設定ファイル
├── src/
│   ├── background/
│   │   └── index.ts           # Service Worker (コンテキストメニュー, 通信制御)
│   ├── content/
│   │   └── index.ts           # Webページ連携スクリプト (任意テキスト取得等)
│   ├── sidepanel/
│   │   ├── index.html         # サイドパネル用HTML
│   │   ├── main.ts            # サイドパネル初期化
│   │   └── App.vue/tsx/ts     # サイドパネルUI
│   ├── fulltab/
│   │   ├── index.html         # 全画面用HTML
│   │   ├── main.ts            # 全画面ビュー初期化
│   │   └── App.vue/tsx/ts     # 全画面UI
│   ├── components/            # ツールバー, マップ一覧ドロップダウン等
│   ├── core/
│   │   ├── mindmap.ts         # mind-elixir ラッパー & 操作API
│   │   ├── shortcuts.ts       # キーボードショートカット管理
│   │   └── exporter.ts        # Markdown/JSON/PNG エクスポート処理
│   ├── storage/
│   │   ├── db.ts              # chrome.storage.local ラッパー
│   │   └── types.ts           # 型定義
│   └── styles/
│       └── theme.css          # MindMeister風テーマ定義
├── package.json
├── tsconfig.json
└── vite.config.ts             # Viteビルド設定
```

---

## 3. 主要コンポーネントの責務と動作仕様

### 3.1 Background Service Worker (`src/background/index.ts`)
* **ライフサイクル**: イベント駆動で起動・停止（アイドル時にスリープするため、内部メモリに変数を永続保持しない）。
* **右クリックメニュー管理**:
  * 拡張機能インストール時に `chrome.contextMenus.create` を実行。
  * メニュー項目：「マインドマップに追加 (現在のノードの子にする)」
  * 選択テキストが存在する場合のみコンテキストメニューに表示。
* **Side Panel の開閉制御**:
  * ツールバーアイコンクリック時に `chrome.sidePanel.open` を実行してサイドパネルを自動展開。

### 3.2 Side Panel View (`src/sidepanel/`)
* **役割**: **マップ管理センター & Webクリッピング司令塔**。
* **画面構成**:
  * **ヘッダー**: 「＋ 新規マップ作成」ボタン、マップ検索入力欄。
  * **マップ一覧リスト**:
    * 保存済みマップ一覧（タイトル、更新日時、ノード数）。
    * 各マップ項目に「全画面で開く」アクションボタン。
  * **Webクリップ・受信ボックス**:
    * 閲覧中Webページの「タイトル & URL をこのマップに追加」ボタン。
    * 選択テキストのクイック送信先マップ選択。

### 3.3 Main Full Tab Editor (`src/fulltab/`)
* **役割**: **MindMeister同等の広大な思考キャンバス（メイン画面）**。
* **機能**:
  * キーボード主体（Tab/Enter）での高速マインドマップ編集。
  * **画像のドラッグ＆ドロップ貼り付け / クリップボードペースト（Ctrl + V）**。
  * **リンク（URL）の貼り付けとファビコン付きクリック展開**。
  * ズーム・パン・全画面表示。

---

## 4. データ構造定義 (Data Schema)

マインドマップのデータは、`chrome.storage.local` 内に以下のJSON構造で保持します。

### 4.1 マップ一覧メタデータ (`storage_key: "map_index"`)
```typescript
interface MapIndexItem {
  id: string;             // UUID (例: "map-550e8400-e29b-41d4-a716-446655440000")
  title: string;          // ルートノードのテキストまたは指定されたタイトル
  createdAt: number;      // 作成日時 (UNIXエポックミリ秒)
  updatedAt: number;      // 最終更新日時
  nodeCount: number;      // ノード総数
}

type MapIndex = MapIndexItem[];
```

### 4.2 マップ本体ツリーデータ (`storage_key: "map_data_{id}"`)
`mind-elixir` 標準の木構造ノード形式に、画像やリンク等のリッチコンテンツ属性を付与。

```typescript
interface NodeData {
  id: string;             // ノードID (一意)
  topic: string;          // ノードの表示テキスト
  children?: NodeData[];  // 子ノード配列
  expanded?: boolean;     // 展開フラグ (true: 展開, false: 折りたたみ)
  style?: {
    color?: string;       // テキスト色
    fill?: string;        // ノード背景色
    fontSize?: number;
  };
  // リッチコンテンツ (画像・リンク)
  image?: {
    url: string;          // 画像データ (Base64 または blob URL)
    width?: number;       // 表示幅 (px)
    height?: number;      // 表示高さ (px)
  };
  hyperlink?: {
    url: string;          // リンク先URL (https://...)
    title?: string;       // リンク先Webタイトル
    favicon?: string;     // ファビコンURL (またはBase64)
  };
  metadata?: {
    sourceUrl?: string;   // 引用元WebページのURL
    sourceTitle?: string; // 引用元Webページのタイトル
    memo?: string;        // 詳細テキストメモ (MindMeisterのノート機能に相当)
  };
}

interface MindMapDocument {
  id: string;
  version: "1.0";
  theme: string;          // "classic", "dark", "mindmeister-blue"
  direction: number;      // 1: 左右放射, 2: 右側展開のみ
  nodeData: NodeData;     // ルートノード (Root Node)
}
```

---

## 5. UI/UX & キーボードショートカット仕様

MindMeisterと同等の快適性を実現するためのキーボードマッピング：

| キー | 動作 | 条件 |
| :--- | :--- | :--- |
| `Tab` | 選択ノードに**「子ノード」**を追加し、即時編集モードへ | ノード選択時 |
| `Enter` | 選択ノードと同じ階層に**「兄弟ノード」**を追加 | ノード選択時（ルート以外） |
| `Space` / `F2` | ノードのテキスト編集を開始 | ノード選択時 |
| `Delete` / `Backspace` | 選択ノード（およびその子孫ノード）を削除 | ノード選択時（非編集時） |
| `↑` `↓` `←` `→` | 隣接するノードへ選択カーソルを移動 | ノード選択時（非編集時） |
| `/` (スラッシュ) | ノードの折りたたみ / 展開をトグル | ノード選択時 |
| `Ctrl + Z` / `Cmd + Z` | 元に戻す (Undo) | 常時 |
| `Ctrl + Y` / `Cmd + Shift + Z` | やり直す (Redo) | 常時 |
| `Space + ドラッグ` | キャンバスのパン（画面移動） | マウス操作 |
| `Ctrl + ホイール` | キャンバスの拡大 / 縮小 (Zoom) | マウス操作 |

---

## 6. セキュリティ & Chrome拡張機能制約対策 (CSP)

1. **インラインスクリプトの禁止**:
   * HTMLファイル内への直接 `<script>...</script>` 記述は禁止。すべてTypeScriptからバンドルされた外部 `.js` ファイルとして読み込む。
2. **`eval()` および `new Function()` の排除**:
   * テンプレートエンジン等で `eval()` を含むライブラリは使用不可。`mind-elixir` はDOMベースの純粋なJS実装であり、この制限をクリアしている。
3. **リモートコード読み込みの禁止**:
   * CDNからの `<script src="https://...">` 読み込みはManifest V3で禁止されているため、すべてのフォント・アイコン・CSS・ライブラリを拡張機能パッケージ内に同梱する。
