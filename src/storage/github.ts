import { MindMapDocument } from './types';

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

const CONFIG_KEY = 'mindflow_github_config';
const FOLDER_PATH = 'mindmaps';

export function getGitHubConfig(): GitHubConfig | null {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveGitHubConfig(config: GitHubConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearGitHubConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

// UTF-8文字列を安全にBase64エンコード
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Base64を安全にUTF-8文字列へデコード
function base64ToUtf8(base64: string): string {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function getHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

// 接続テスト
export async function testGitHubConnection(config: GitHubConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
    const res = await fetch(url, { headers: getHeaders(config.token) });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, message: `接続成功！リポジトリ「${data.full_name}」(${data.private ? 'Private' : 'Public'}) にアクセス可能です。` };
    }
    if (res.status === 401) {
      return { ok: false, message: '認証エラー: トークンが無効です。' };
    }
    if (res.status === 404) {
      return { ok: false, message: 'リポジトリが見つかりません。名前またはトークンのリポジトリアクセス権限を確認してください。' };
    }
    return { ok: false, message: `エラー (${res.status}): ${res.statusText}` };
  } catch (err: any) {
    return { ok: false, message: `通信エラー: ${err.message}` };
  }
}

// ファイルの現在のSHAを取得 (更新時に必要)
async function getFileSha(config: GitHubConfig, filePath: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}?ref=${encodeURIComponent(config.branch)}`;
  const res = await fetch(url, { headers: getHeaders(config.token), cache: 'no-store' });
  if (res.ok) {
    const data = await res.json();
    return data.sha || null;
  }
  return null;
}

// 単一マップをGitHubに保存 (Push)
export async function pushMapToGitHub(config: GitHubConfig, doc: MindMapDocument): Promise<void> {
  const filePath = `${FOLDER_PATH}/${doc.id}.json`;
  const sha = await getFileSha(config, filePath);
  const content = utf8ToBase64(JSON.stringify(doc, null, 2));

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}`;
  const body: any = {
    message: `Update mindmap: ${doc.title || doc.id}`,
    content,
    branch: config.branch
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: getHeaders(config.token),
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub Push Error (${res.status})`);
  }
}

// GitHubから全マップ一覧を取得してダウンロード (Pull)
export async function pullMapsFromGitHub(config: GitHubConfig): Promise<MindMapDocument[]> {
  const dirUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${FOLDER_PATH}?ref=${encodeURIComponent(config.branch)}`;
  const res = await fetch(dirUrl, { headers: getHeaders(config.token), cache: 'no-store' });

  if (res.status === 404) {
    // まだフォルダが作成されていない（初回）
    return [];
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `GitHub Pull Error (${res.status})`);
  }

  const items = await res.json();
  if (!Array.isArray(items)) return [];

  const jsonFiles = items.filter((item: any) => item.type === 'file' && item.name.endsWith('.json'));
  const maps: MindMapDocument[] = [];

  for (const file of jsonFiles) {
    const fileRes = await fetch(file.url, { headers: getHeaders(config.token), cache: 'no-store' });
    if (fileRes.ok) {
      const fileData = await fileRes.json();
      if (fileData.content) {
        try {
          const decoded = base64ToUtf8(fileData.content);
          const parsed = JSON.parse(decoded) as MindMapDocument;
          if (parsed && parsed.id && parsed.nodeData) {
            maps.push(parsed);
          }
        } catch (e) {
          console.warn(`Failed to parse ${file.name}:`, e);
        }
      }
    }
  }

  return maps;
}

// GitHub上のマップを削除
export async function deleteMapFromGitHub(config: GitHubConfig, mapId: string): Promise<void> {
  const filePath = `${FOLDER_PATH}/${mapId}.json`;
  const sha = await getFileSha(config, filePath);
  if (!sha) return;

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${filePath}`;
  await fetch(url, {
    method: 'DELETE',
    headers: getHeaders(config.token),
    body: JSON.stringify({
      message: `Delete mindmap: ${mapId}`,
      sha,
      branch: config.branch
    })
  });
}
