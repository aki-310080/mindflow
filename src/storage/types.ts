export interface NodeData {
  id: string;
  topic: string;
  children?: NodeData[];
  expanded?: boolean;
  style?: {
    color?: string;
    fill?: string;
    fontSize?: number;
  };
  image?: {
    url: string;
    width?: number;
    height?: number;
  };
  hyperlink?: {
    url: string;
    title?: string;
    favicon?: string;
  };
  memo?: string;
}

export type ViewMode = 'mindmap' | 'org' | 'list';

export interface MindMapDocument {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  direction?: number; // 1: 放射状, 2: 右展開
  viewMode?: ViewMode;
  nodeData: NodeData;
}

export interface MapIndexItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
}
