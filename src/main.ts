import MindElixir, { Outliner } from 'mind-elixir';
import 'mind-elixir/style.css';
import {
  getMapList,
  getMap,
  saveMap,
  deleteMap,
  getCurrentMapId,
  setCurrentMapId,
  createDefaultMap
} from './storage/db';
import {
  getGitHubConfig,
  saveGitHubConfig,
  testGitHubConnection,
  pushMapToGitHub,
  pullMapsFromGitHub,
  deleteMapFromGitHub,
  GitHubConfig
} from './storage/github';
import { compressImageToBase64, CompressedImage } from './utils/image';
import { MindMapDocument, ViewMode } from './storage/types';

// DOM Elements
const sidebar = document.getElementById('sidebar') as HTMLElement;
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar') as HTMLButtonElement;
const listContainer = document.getElementById('map-list') as HTMLDivElement;
const btnNewMap = document.getElementById('btn-new-map') as HTMLButtonElement;
const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;
const btnImportJson = document.getElementById('btn-import-json') as HTMLButtonElement;
const jsonFileInput = document.getElementById('json-file-input') as HTMLInputElement;

// GitHub DOM Elements
const btnGithubSettings = document.getElementById('btn-github-settings') as HTMLButtonElement;
const githubStatusBadge = document.getElementById('github-status-badge') as HTMLSpanElement;
const btnGithubPush = document.getElementById('btn-github-push') as HTMLButtonElement;
const btnGithubPull = document.getElementById('btn-github-pull') as HTMLButtonElement;

const githubModal = document.getElementById('github-modal') as HTMLDivElement;
const btnCloseModal = document.getElementById('btn-close-modal') as HTMLButtonElement;
const ghOwnerInput = document.getElementById('gh-owner') as HTMLInputElement;
const ghRepoInput = document.getElementById('gh-repo') as HTMLInputElement;
const ghBranchInput = document.getElementById('gh-branch') as HTMLInputElement;
const ghTokenInput = document.getElementById('gh-token') as HTMLInputElement;
const ghTestResult = document.getElementById('gh-test-result') as HTMLDivElement;
const btnGhTest = document.getElementById('btn-gh-test') as HTMLButtonElement;
const btnGhSave = document.getElementById('btn-gh-save') as HTMLButtonElement;

// Editor DOM Elements
const mapContainer = document.getElementById('map-container') as HTMLDivElement;
const outlineContainer = document.getElementById('outline-container') as HTMLDivElement;
const btnLayoutPicker = document.getElementById('btn-layout-picker') as HTMLButtonElement;
const currentLayoutLabel = document.getElementById('current-layout-label') as HTMLSpanElement;
const layoutPopover = document.getElementById('layout-popover') as HTMLDivElement;
const mapTitleInput = document.getElementById('map-title-input') as HTMLInputElement;
const saveStatus = document.getElementById('save-status') as HTMLSpanElement;
const btnAddImage = document.getElementById('btn-add-image') as HTMLButtonElement;
const btnAddLink = document.getElementById('btn-add-link') as HTMLButtonElement;
const btnExportPng = document.getElementById('btn-export-png') as HTMLButtonElement;
const btnExportMd = document.getElementById('btn-export-md') as HTMLButtonElement;
const imageFileInput = document.getElementById('image-file-input') as HTMLInputElement;

let currentDoc: MindMapDocument | null = null;
let mind: any = null;
let outliner: any = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ==========================================
// 1. 初期化 & マップ読み込み
// ==========================================
async function init() {
  // ボタン類がいつでも反応するよう、まず最初にイベントを登録する
  setupUIEvents();
  setupGitHubEvents();
  setupRichContentHandlers();
  updateGitHubBadge();

  try {
    let mapId = await getCurrentMapId();
    if (mapId) {
      currentDoc = await getMap(mapId);
    }

    if (!currentDoc) {
      const list = await getMapList();
      if (list.length > 0) {
        currentDoc = await getMap(list[0].id);
      } else {
        currentDoc = createDefaultMap('最初のマインドマップ');
        await saveMap(currentDoc);
      }
    }

    if (currentDoc) {
      await setCurrentMapId(currentDoc.id);
      await loadMapIntoCanvas(currentDoc);
    }

    await renderSidebarList();
  } catch (err) {
    console.error('Initialization error:', err);
  }
}

async function loadMapIntoCanvas(doc: MindMapDocument) {
  currentDoc = doc;
  mapTitleInput.value = doc.nodeData.topic.replace(/<[^>]*>/g, '').trim() || doc.title;
  document.title = `${mapTitleInput.value} - MindFlow`;

  if (!mind) {
    mind = new MindElixir({
      el: mapContainer,
      direction: MindElixir.SIDE,
      contextMenu: true,
      toolBar: false,
      keypress: true
    });

    await mind.init({
      nodeData: doc.nodeData
    });

    try {
      outliner = new Outliner({
        el: outlineContainer,
        mei: mind
      });
    } catch (e) {
      console.warn('Outliner init warning:', e);
    }

    mind.bus.addListener('operation', () => {
      scheduleAutoSave();
    });
  } else {
    await mind.refresh({
      nodeData: doc.nodeData
    });
  }

  applyViewMode(doc.viewMode || 'mindmap', false);
}

// ==========================================
// 表示形式の切り替え (マインドマップ / 組織図 / リスト)
// ==========================================
function applyViewMode(mode: ViewMode, shouldSave = true) {
  const labels: Record<ViewMode, string> = {
    mindmap: 'マインドマップ',
    org: '組織図',
    list: 'リスト'
  };
  currentLayoutLabel.textContent = labels[mode];

  // カードのアクティブ状態を更新
  const cards = layoutPopover.querySelectorAll('.layout-card');
  cards.forEach((card) => {
    card.classList.toggle('active', card.getAttribute('data-mode') === mode);
  });

  if (mode === 'list') {
    mapContainer.classList.add('hidden');
    outlineContainer.classList.add('active');
    if (outliner && typeof outliner.render === 'function') {
      outliner.render();
    }
  } else {
    outlineContainer.classList.remove('active');
    mapContainer.classList.remove('hidden');
    if (mind) {
      if (mode === 'org') {
        mind.initDown();
      } else {
        mind.initSide();
      }
    }
  }

  if (currentDoc) {
    currentDoc.viewMode = mode;
    if (shouldSave) {
      scheduleAutoSave();
    }
  }
}

// ==========================================
// 2. ローカル自動保存 (IndexedDB)
// ==========================================
function scheduleAutoSave() {
  saveStatus.textContent = '○ 保存中...';
  saveStatus.style.color = '#f59e0b';

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!currentDoc || !mind) return;
    try {
      const data = mind.getData();
      currentDoc.nodeData = data.nodeData;
      const plainTitle = mapTitleInput.value.trim();
      if (plainTitle) {
        currentDoc.title = plainTitle;
      }

      await saveMap(currentDoc);
      saveStatus.textContent = '● 保存済み';
      saveStatus.style.color = '#10b981';

      await renderSidebarList();
    } catch (err) {
      console.error('Save failed:', err);
      saveStatus.textContent = '✕ 保存失敗';
      saveStatus.style.color = '#ef4444';
    }
  }, 500);
}

// ==========================================
// 3. サイドバー (マップ管理) の描画 & 操作
// ==========================================
async function renderSidebarList() {
  const list = await getMapList();
  listContainer.innerHTML = '';

  list.forEach((item) => {
    const card = document.createElement('div');
    card.className = `map-card ${currentDoc && item.id === currentDoc.id ? 'active' : ''}`;

    const dateStr = new Date(item.updatedAt).toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="map-card-header">
        <span class="map-card-title" title="${item.title}">${item.title}</span>
        <button class="btn btn-sm btn-delete" style="color: #ef4444; padding: 2px 6px; border: none; background: transparent;" title="削除">✕</button>
      </div>
      <div class="map-card-meta">
        <span>${dateStr}</span>
        <span class="badge">${item.nodeCount} ノード</span>
      </div>
    `;

    card.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('btn-delete')) {
        e.stopPropagation();
        if (confirm(`「${item.title}」を削除してもよろしいですか？`)) {
          await deleteMap(item.id);
          const ghConfig = getGitHubConfig();
          if (ghConfig) {
            deleteMapFromGitHub(ghConfig, item.id).catch(() => {});
          }

          const remaining = await getMapList();
          if (remaining.length === 0) {
            const fresh = createDefaultMap('新しいマインドマップ');
            await saveMap(fresh);
            await setCurrentMapId(fresh.id);
            loadMapIntoCanvas(fresh);
          } else if (currentDoc && currentDoc.id === item.id) {
            const nextDoc = await getMap(remaining[0].id);
            if (nextDoc) {
              await setCurrentMapId(nextDoc.id);
              loadMapIntoCanvas(nextDoc);
            }
          }
          await renderSidebarList();
        }
        return;
      }

      if (currentDoc && currentDoc.id === item.id) return;
      const doc = await getMap(item.id);
      if (doc) {
        await setCurrentMapId(doc.id);
        loadMapIntoCanvas(doc);
        await renderSidebarList();
      }
    });

    listContainer.appendChild(card);
  });
}

function setupUIEvents() {
  btnToggleSidebar.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // 表示形式ポップオーバーの開閉
  btnLayoutPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    layoutPopover.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!layoutPopover.contains(e.target as Node) && e.target !== btnLayoutPicker) {
      layoutPopover.classList.remove('open');
    }
  });

  layoutPopover.querySelectorAll('.layout-card').forEach((card) => {
    card.addEventListener('click', () => {
      const mode = card.getAttribute('data-mode') as ViewMode;
      if (mode) {
        applyViewMode(mode, true);
        layoutPopover.classList.remove('open');
      }
    });
  });

  btnNewMap.addEventListener('click', async () => {
    const title = prompt('新しいマップのタイトルを入力してください:', '新規マインドマップ');
    if (!title) return;

    const doc = createDefaultMap(title);
    await saveMap(doc);
    await setCurrentMapId(doc.id);
    loadMapIntoCanvas(doc);
    await renderSidebarList();
  });

  mapTitleInput.addEventListener('input', () => {
    if (!currentDoc || !mind) return;
    const newTitle = mapTitleInput.value.trim() || '無題';
    currentDoc.title = newTitle;
    if (mind.nodeData) {
      mind.nodeData.topic = newTitle;
      mind.refresh();
    }
    document.title = `${newTitle} - MindFlow`;
    scheduleAutoSave();
  });

  btnExportJson.addEventListener('click', () => {
    if (!currentDoc || !mind) return;
    const data = mind.getData();
    const exportDoc: MindMapDocument = {
      ...currentDoc,
      nodeData: data.nodeData
    };
    const jsonStr = JSON.stringify(exportDoc, null, 2);
    downloadFile(`${currentDoc.title || 'mindmap'}.json`, jsonStr, 'application/json');
  });

  btnImportJson.addEventListener('click', () => {
    jsonFileInput.click();
  });

  jsonFileInput.addEventListener('change', async () => {
    const file = jsonFileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as MindMapDocument;
      if (!parsed.nodeData || !parsed.nodeData.topic) {
        alert('有効なMindFlow JSONファイルではありません。');
        return;
      }
      parsed.id = 'map_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      parsed.updatedAt = Date.now();
      await saveMap(parsed);
      await setCurrentMapId(parsed.id);
      loadMapIntoCanvas(parsed);
      await renderSidebarList();
    } catch {
      alert('JSONファイルの読み込みに失敗しました。');
    } finally {
      jsonFileInput.value = '';
    }
  });
}

// ==========================================
// 4. GitHub プライベートリポジトリ連携
// ==========================================
function updateGitHubBadge() {
  const cfg = getGitHubConfig();
  if (cfg && cfg.owner && cfg.repo && cfg.token) {
    githubStatusBadge.textContent = `${cfg.owner}/${cfg.repo}`;
    githubStatusBadge.style.color = '#0284c7';
  } else {
    githubStatusBadge.textContent = '未設定';
    githubStatusBadge.style.color = 'var(--text-muted)';
  }
}

function getModalInputConfig(): GitHubConfig {
  return {
    owner: ghOwnerInput.value.trim(),
    repo: ghRepoInput.value.trim(),
    branch: ghBranchInput.value.trim() || 'main',
    token: ghTokenInput.value.trim()
  };
}

function setupGitHubEvents() {
  // モーダルを開く
  btnGithubSettings.addEventListener('click', () => {
    const cfg = getGitHubConfig();
    if (cfg) {
      ghOwnerInput.value = cfg.owner;
      ghRepoInput.value = cfg.repo;
      ghBranchInput.value = cfg.branch || 'main';
      ghTokenInput.value = cfg.token;
    }
    ghTestResult.style.display = 'none';
    githubModal.classList.add('open');
  });

  btnCloseModal.addEventListener('click', () => {
    githubModal.classList.remove('open');
  });

  githubModal.addEventListener('click', (e) => {
    if (e.target === githubModal) {
      githubModal.classList.remove('open');
    }
  });

  // 接続テスト
  btnGhTest.addEventListener('click', async () => {
    const cfg = getModalInputConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      alert('ユーザー名、リポジトリ名、トークンを入力してください。');
      return;
    }
    btnGhTest.disabled = true;
    btnGhTest.textContent = '確認中...';
    const result = await testGitHubConnection(cfg);
    btnGhTest.disabled = false;
    btnGhTest.textContent = '接続テスト';

    ghTestResult.style.display = 'block';
    ghTestResult.textContent = result.message;
    ghTestResult.style.background = result.ok ? '#dcfce7' : '#fee2e2';
    ghTestResult.style.color = result.ok ? '#166534' : '#991b1b';
  });

  // 設定保存
  btnGhSave.addEventListener('click', () => {
    const cfg = getModalInputConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      alert('すべての必須項目を入力してください。');
      return;
    }
    saveGitHubConfig(cfg);
    updateGitHubBadge();
    githubModal.classList.remove('open');
  });

  // Push (現在のマップをGitHubへアップロード)
  btnGithubPush.addEventListener('click', async () => {
    const cfg = getGitHubConfig();
    if (!cfg) {
      btnGithubSettings.click();
      return;
    }
    if (!currentDoc || !mind) return;

    const origText = btnGithubPush.textContent;
    btnGithubPush.disabled = true;
    btnGithubPush.textContent = '⏳ 送信中...';

    try {
      // 最新エディタ状態をローカルにも保存してからPush
      const data = mind.getData();
      currentDoc.nodeData = data.nodeData;
      await saveMap(currentDoc);

      await pushMapToGitHub(cfg, currentDoc);
      githubStatusBadge.textContent = '同期完了 ✓';
      githubStatusBadge.style.color = '#10b981';
      setTimeout(updateGitHubBadge, 3000);
    } catch (err: any) {
      alert(`GitHubへの保存に失敗しました:\n${err.message}`);
    } finally {
      btnGithubPush.disabled = false;
      btnGithubPush.textContent = origText;
    }
  });

  // Pull (GitHubから全マップを取得してローカルと同期)
  btnGithubPull.addEventListener('click', async () => {
    const cfg = getGitHubConfig();
    if (!cfg) {
      btnGithubSettings.click();
      return;
    }

    const origText = btnGithubPull.textContent;
    btnGithubPull.disabled = true;
    btnGithubPull.textContent = '⏳ 取得中...';

    try {
      const remoteMaps = await pullMapsFromGitHub(cfg);
      if (remoteMaps.length === 0) {
        alert('GitHub上にまだ保存されたマップがありません。');
        return;
      }

      let importedCount = 0;
      for (const remoteDoc of remoteMaps) {
        await saveMap(remoteDoc, true);
        importedCount++;
      }

      // 更新日時が一番新しいリモートマップを特定
      const sortedRemote = [...remoteMaps].sort((a, b) => b.updatedAt - a.updatedAt);
      const currentInRemote = currentDoc ? remoteMaps.find((m) => m.id === currentDoc!.id) : null;
      const targetToLoad = currentInRemote || sortedRemote[0];

      if (targetToLoad) {
        await setCurrentMapId(targetToLoad.id);
        await loadMapIntoCanvas(targetToLoad);
      }
      await renderSidebarList();

      githubStatusBadge.textContent = `${importedCount}件同期 ✓`;
      githubStatusBadge.style.color = '#10b981';
      setTimeout(updateGitHubBadge, 3000);
    } catch (err: any) {
      alert(`GitHubからの読み込みに失敗しました:\n${err.message}`);
    } finally {
      btnGithubPull.disabled = false;
      btnGithubPull.textContent = origText;
    }
  });
}

// ==========================================
// 5. 画像・リンク貼付 & エクスポート
// ==========================================
function setupRichContentHandlers() {
  window.addEventListener('paste', async (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const activeNode = mind?.currentNode;
    if (!activeNode) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const base64 = await compressImageToBase64(file);
          attachImageToNode(activeNode, base64);
          return;
        }
      }
    }

    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      e.preventDefault();
      attachLinkToNode(activeNode, text);
    }
  });

  btnAddImage.addEventListener('click', () => {
    if (!mind?.currentNode) {
      alert('画像を挿入したいノードをクリックして選択してください');
      return;
    }
    imageFileInput.click();
  });

  imageFileInput.addEventListener('change', async () => {
    if (imageFileInput.files && imageFileInput.files[0] && mind?.currentNode) {
      const base64 = await compressImageToBase64(imageFileInput.files[0]);
      attachImageToNode(mind.currentNode, base64);
      imageFileInput.value = '';
    }
  });

  btnAddLink.addEventListener('click', () => {
    if (!mind?.currentNode) {
      alert('リンクを設定したいノードをクリックして選択してください');
      return;
    }
    const url = prompt('リンク先のURLを入力してください:', 'https://');
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      attachLinkToNode(mind.currentNode, url);
    }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;

    const file = e.dataTransfer.files[0];
    if (file.type.startsWith('image/') && mind?.currentNode) {
      const base64 = await compressImageToBase64(file);
      attachImageToNode(mind.currentNode, base64);
    }
  });

  btnExportMd.addEventListener('click', () => {
    if (!currentDoc || !mind) return;
    const data = mind.getData();
    const md = exportToMarkdown(data.nodeData, 0);
    downloadFile(`${currentDoc.title || 'mindmap'}.md`, md, 'text/markdown');
  });

  btnExportPng.addEventListener('click', async () => {
    if (!mind) return;
    try {
      if (typeof mind.exportPng === 'function') {
        const blob = await mind.exportPng();
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${currentDoc?.title || 'mindmap'}.png`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
      }
      alert('ブラウザの印刷機能またはスクリーンショットをご利用ください');
    } catch {
      alert('画像書き出しに失敗しました');
    }
  });
}

function attachImageToNode(nodeEle: any, img: CompressedImage) {
  const nodeObj = nodeEle.nodeObj;
  // もし旧方式のHTML文字列が混入していた場合は取り除く
  nodeObj.topic = nodeObj.topic.replace(/<img[^>]*>(\s*<br\s*\/?>)?/gi, '').trim() || '画像';
  nodeObj.image = {
    url: img.url,
    width: img.width,
    height: img.height,
    fit: 'contain'
  };

  mind.reshapeNode(nodeEle, nodeObj);
  scheduleAutoSave();
}

function attachLinkToNode(nodeEle: any, url: string) {
  const nodeObj = nodeEle.nodeObj;
  nodeObj.topic = nodeObj.topic.replace(/<a[^>]*class="mindflow-link-pill"[^>]*>.*?<\/a>/gi, '').trim();
  nodeObj.hyperLink = url;

  mind.reshapeNode(nodeEle, nodeObj);
  scheduleAutoSave();
}

function exportToMarkdown(node: any, depth = 0): string {
  const indent = '  '.repeat(depth);
  const plainTopic = node.topic.replace(/<[^>]*>/g, '').trim();
  let result = `${indent}- ${plainTopic}\n`;

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      result += exportToMarkdown(child, depth + 1);
    }
  }
  return result;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 起動
init();
