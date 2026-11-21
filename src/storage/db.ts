import { MapIndexItem, MindMapDocument, NodeData } from './types';

const DB_NAME = 'MindFlowDB';
const DB_VERSION = 1;
const STORE_MAPS = 'maps';
const STORE_META = 'meta';
const CURRENT_MAP_KEY = 'current_map_id';

// IndexedDB の接続取得
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_MAPS)) {
        db.createObjectStore(STORE_MAPS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 初期サンプルのマインドマップ
export function createDefaultMap(title = '新規マインドマップ'): MindMapDocument {
  const id = 'map_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = Date.now();
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    direction: 1,
    nodeData: {
      id: 'root',
      topic: title,
      children: [
        {
          id: 'sub1',
          topic: 'アイデア 1 (Tabで子ノード)',
          children: [
            { id: 'sub1_1', topic: '詳細・メモ' },
            { id: 'sub1_2', topic: 'Ctrl+Vで画像やリンクも貼れます' }
          ]
        },
        {
          id: 'sub2',
          topic: 'アイデア 2 (Enterで兄弟ノード)',
          children: [
            { id: 'sub2_1', topic: 'Space+ドラッグで画面移動' }
          ]
        }
      ]
    }
  };
}

// ノード数をカウントするヘルパー
export function countNodes(node: NodeData): number {
  let count = 1;
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

// マップ一覧の取得（更新日時の新しい順）
export async function getMapList(): Promise<MapIndexItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MAPS, 'readonly');
    const store = tx.objectStore(STORE_MAPS);
    const req = store.getAll();
    req.onsuccess = () => {
      const docs = (req.result as MindMapDocument[]) || [];
      const list: MapIndexItem[] = docs
        .map((doc) => ({
          id: doc.id,
          title: doc.nodeData?.topic ? doc.nodeData.topic.replace(/<[^>]*>/g, '').trim() || doc.title : doc.title,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          nodeCount: countNodes(doc.nodeData)
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

// 現在選択されているマップID
export async function getCurrentMapId(): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const store = tx.objectStore(STORE_META);
    const req = store.get(CURRENT_MAP_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setCurrentMapId(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    const store = tx.objectStore(STORE_META);
    const req = store.put(id, CURRENT_MAP_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// 特定マップの取得
export async function getMap(id: string): Promise<MindMapDocument | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MAPS, 'readonly');
    const store = tx.objectStore(STORE_MAPS);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// 特定マップの保存
export async function saveMap(doc: MindMapDocument): Promise<void> {
  doc.updatedAt = Date.now();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MAPS, 'readwrite');
    const store = tx.objectStore(STORE_MAPS);
    const req = store.put(doc);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// マップの削除
export async function deleteMap(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MAPS, 'readwrite');
    const store = tx.objectStore(STORE_MAPS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
