import fs from 'fs';
import path from 'path';

// ─── 数据结构 ─────────────────────────────────────────────────────────────────

export interface CoreMemoryItem {
  id: string;
  /** 记忆内容，一句话概括 */
  content: string;
  /** 首次记录日期 YYYY-MM-DD */
  firstSeen: string;
  /** 被强化（重复出现）的次数，数值越高代表越重要 */
  reinforceCount: number;
}

export interface CoreMemoryData {
  updatedAt: string;
  memories: CoreMemoryItem[];
}

export interface LifeMemoryFile {
  filename: string;
  date: string;
  content: string;
}

// ─── 目录管理 ─────────────────────────────────────────────────────────────────

/** 返回 .memory/ 目录路径，不存在则自动创建 */
export function getMemoryDir(cwd: string): string {
  const dir = path.join(cwd, '.memory');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lifeDir = path.join(dir, 'life');
  if (!fs.existsSync(lifeDir)) fs.mkdirSync(lifeDir, { recursive: true });
  return dir;
}

// ─── coreMemory 读写 ──────────────────────────────────────────────────────────

export function getCoreMemory(cwd: string): CoreMemoryData {
  const filePath = path.join(getMemoryDir(cwd), 'core-memory.json');
  if (!fs.existsSync(filePath)) {
    return { updatedAt: todayStr(), memories: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CoreMemoryData;
  } catch {
    return { updatedAt: todayStr(), memories: [] };
  }
}

export function saveCoreMemory(cwd: string, data: CoreMemoryData): void {
  const filePath = path.join(getMemoryDir(cwd), 'core-memory.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── lifeMemory 读写 ──────────────────────────────────────────────────────────

/**
 * 保存今日 lifeMemory 文件
 * 文件名：lifeMemory-<主题>-<日期>-<shortid>.md
 * 返回文件名
 */
export function appendLifeMemory(cwd: string, theme: string, summary: string): string {
  const dir = getMemoryDir(cwd);
  const lifeDir = path.join(dir, 'life');
  const shortid = Date.now().toString(36);
  const date = todayStr();
  // 清理主题词，使其可用于文件名
  const safeTheme = theme.replace(/[/\\:*?"<>|\s]/g, '-').replace(/-+/g, '-').slice(0, 20);
  const filename = `lifeMemory-${safeTheme}-${date}-${shortid}.md`;
  const filePath = path.join(lifeDir, filename);
  const content = `# ${theme}\n\n日期：${date}\n\n${summary}\n`;
  fs.writeFileSync(filePath, content, 'utf-8');
  return filename;
}

/**
 * 读取最近 N 天的 lifeMemory 文件（按日期升序）
 */
export function getRecentLifeMemories(cwd: string, days = 7): LifeMemoryFile[] {
  const lifeDir = path.join(getMemoryDir(cwd), 'life');
  if (!fs.existsSync(lifeDir)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return fs
    .readdirSync(lifeDir)
    .filter(f => f.startsWith('lifeMemory-') && f.endsWith('.md'))
    .map(f => ({
      filename: f,
      date: extractDateFromFilename(f),
      content: fs.readFileSync(path.join(lifeDir, f), 'utf-8'),
    }))
    .filter(f => new Date(f.date) >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractDateFromFilename(filename: string): string {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : todayStr();
}
