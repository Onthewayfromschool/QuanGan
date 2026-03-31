import path from 'path';
import os from 'os';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { ToolDefinition, ToolFunction } from './types.js';

/**
 * 工具：Playwright 浏览器自动化
 *
 * 策略（按优先级）：
 *   1. CDP 模式（可选）：连接用户用调试端口启动的 Chrome
 *      需要：open -a "Google Chrome" --args --remote-debugging-port=9222 --remote-allow-origins=*
 *   2. 持久化专属浏览器（默认 fallback）：
 *      Profile 保存在 ~/.xiaoyu-browser-profile，登录态一次登录永久保留
 *      首次使用需在弹出的窗口里手动登录 QQ 音乐等网站
 *
 * 支持的 action：
 *   navigate       - 打开 URL，返回页面标题 + 当前 URL
 *   click          - 点击指定 CSS 选择器的元素
 *   type           - 清空后向输入框键入文字
 *   press_key      - 按下键盘按键（Enter / Escape / ArrowDown 等）
 *   get_page_text  - 获取页面可见文本（截断至 2000 字符）
 *   get_elements   - 查询匹配选择器的元素列表（返回 tag/text/id/class）
 *   wait_for       - 等待某选择器出现（最长 10s）
 *   close          - 关闭当前页面（profile 仍保留，下次打开已登录）
 */

const CDP_ENDPOINT = 'http://localhost:9222';
/** 持久化 Profile 目录：登录态、Cookie 永久保存在此，不影响用户的 Chrome */
const PROFILE_DIR = path.join(os.homedir(), '.xiaoyu-browser-profile');

// 连接模式：'cdp' | 'persistent' | 'unknown'
type Mode = 'cdp' | 'persistent' | 'unknown';
let mode: Mode = 'unknown';
let cdpBrowser: Browser | null = null;
let cdpContext: BrowserContext | null = null;
/** 持久化浏览器 context（launchPersistentContext 返回的即是 context） */
let persistentCtx: BrowserContext | null = null;
let page: Page | null = null;
/** 最近一次 CDP 连接失败的原因 */
let lastCdpError = '';

/** 确保有可用的 BrowserContext */
async function ensureContext(): Promise<{ ctx: BrowserContext; mode: Mode }> {
  // ── CDP 模式：已有连接且仍有效 ──────────────────────────────────────────
  if (mode === 'cdp' && cdpBrowser && cdpBrowser.isConnected() && cdpContext) {
    return { ctx: cdpContext, mode: 'cdp' };
  }

  // ── 持久化模式：已有 context ──────────────────────────────────────────────
  if (mode === 'persistent' && persistentCtx) {
    return { ctx: persistentCtx, mode: 'persistent' };
  }

  // ── 尝试 CDP（用户若开了调试端口则优先用，否则跳过）────────────────────
  try {
    cdpBrowser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 3000 });
    const contexts = cdpBrowser.contexts();
    cdpContext = contexts.length > 0 ? contexts[0] : await cdpBrowser.newContext();
    mode = 'cdp';
    lastCdpError = '';
    return { ctx: cdpContext, mode: 'cdp' };
  } catch (e: any) {
    lastCdpError = (e?.message || String(e)).split('\n')[0];
  }

  // ── 持久化专属浏览器（默认路径）─────────────────────────────────────────
  persistentCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 50,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  mode = 'persistent';
  return { ctx: persistentCtx, mode: 'persistent' };
}

async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  // 尝试在已有 context 里新开 tab
  if (mode === 'cdp' && cdpContext) {
    try {
      page = await cdpContext.newPage();
      return page;
    } catch {
      cdpContext = null;
      cdpBrowser = null;
      mode = 'unknown';
    }
  }
  if (mode === 'persistent' && persistentCtx) {
    try {
      page = await persistentCtx.newPage();
      return page;
    } catch {
      persistentCtx = null;
      mode = 'unknown';
    }
  }

  const { ctx } = await ensureContext();
  page = await ctx.newPage();
  return page;
}

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_action',
    description: `用 Playwright 控制浏览器执行网页操作，适合需要自动化操作网页的任务。
浏览器以有头模式运行，用户可以看到操作过程。

常见使用场景：
  - 在 y.qq.com 搜索并播放歌曲
  - 自动填写网页表单
  - 在任意网站执行点击、输入、导航等操作

action 说明：
  navigate      打开 url，必须传 url 参数
  click         点击元素，必须传 selector（CSS 选择器）
  type          向输入框键入文字，必须传 selector + text
  press_key     按下按键，必须传 key（如 Enter、Escape、ArrowDown）
  get_page_text 获取当前页面可见文本（用于了解页面内容）
  get_elements  查询元素列表，必须传 selector，返回匹配元素的 tag/text/属性
  wait_for      等待某元素出现，必须传 selector（最长等 10s）
  close         关闭浏览器并清理实例`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'click', 'type', 'press_key', 'get_page_text', 'get_elements', 'wait_for', 'close'],
          description: '要执行的操作类型',
        },
        url: {
          type: 'string',
          description: 'navigate 时必填，要打开的完整 URL',
        },
        selector: {
          type: 'string',
          description: 'click / type / get_elements / wait_for 时必填，CSS 选择器',
        },
        text: {
          type: 'string',
          description: 'type 时必填，要输入的文字',
        },
        key: {
          type: 'string',
          description: 'press_key 时必填，按键名称，如 Enter、Escape、ArrowDown、Tab',
        },
      },
      required: ['action'],
    },
  },
};

// ─── 工具实现 ─────────────────────────────────────────────────────────────────

export const implementation: ToolFunction = async (args: {
  action: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
}) => {
  const { action, url, selector, text, key } = args;

  try {
    // close 不需要 page
    if (action === 'close') {
      if (page && !page.isClosed()) { await page.close(); }
      page = null;
      if (mode === 'cdp') {
        cdpContext = null;
        cdpBrowser = null;
        mode = 'unknown';
        return '✅ 已关闭 Playwright 连接（你的 Chrome 仍在运行）';
      } else {
        // 持久化模式：保留 context（保留登录态），只关段当前页面
        return '✅ 已关闭当前页面（专属浏览器仍在后台，登录态已保存）';
      }
    }

    const pg = await getPage();

    switch (action) {
      // ── navigate ────────────────────────────────────────────────────────────
      case 'navigate': {
        if (!url) return '❌ navigate 需要传 url 参数';
        await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await pg.title();
        if (mode === 'cdp') {
          return `✅ 已在你的 Chrome 中打开：${pg.url()}（登录态有效）\n页面标题：${title}`;
        } else {
          // 持久化专属浏览器
          const firstTimeHint = `⚠️ 如是首次使用，请在弹出的浏览器窗口中手动登录所需网站，登录后下次会自动复用登录态`;
          return `✅ 已在专属浏览器中打开：${pg.url()}\n页面标题：${title}\n${firstTimeHint}`;
        }
      }

      // ── click ────────────────────────────────────────────────────────────────
      case 'click': {
        if (!selector) return '❌ click 需要传 selector 参数';
        await pg.waitForSelector(selector, { timeout: 8000 });
        await pg.click(selector);
        return `✅ 已点击：${selector}`;
      }

      // ── type ─────────────────────────────────────────────────────────────────
      case 'type': {
        if (!selector) return '❌ type 需要传 selector 参数';
        if (text === undefined) return '❌ type 需要传 text 参数';
        await pg.waitForSelector(selector, { timeout: 8000 });
        await pg.click(selector);
        await pg.fill(selector, text);
        return `✅ 已向 ${selector} 输入："${text}"`;
      }

      // ── press_key ────────────────────────────────────────────────────────────
      case 'press_key': {
        if (!key) return '❌ press_key 需要传 key 参数';
        await pg.keyboard.press(key);
        return `✅ 已按下按键：${key}`;
      }

      // ── get_page_text ────────────────────────────────────────────────────────
      case 'get_page_text': {
        await pg.waitForLoadState('domcontentloaded');
        const bodyText: string = await pg.evaluate(() => {
          // 去掉 script / style 标签后取 innerText
          const clone = (document.body as any).cloneNode(true) as any;
          clone.querySelectorAll('script, style, noscript').forEach((el: any) => el.remove());
          return (clone as any).innerText || '';
        });
        const trimmed = bodyText.replace(/\s+/g, ' ').trim();
        const preview = trimmed.length > 2000 ? trimmed.slice(0, 2000) + '\n...(已截断)' : trimmed;
        return `📄 页面文本（${pg.url()}）：\n${preview}`;
      }

      // ── get_elements ─────────────────────────────────────────────────────────
      case 'get_elements': {
        if (!selector) return '❌ get_elements 需要传 selector 参数';
        const elements = await pg.evaluate((sel: string) => {
          const nodes = Array.from((document as any).querySelectorAll(sel)) as any[];
          return nodes.slice(0, 20).map((el: any, i: number) => {
            const tag = el.tagName.toLowerCase();
            const text = (el.innerText || el.textContent || '').trim().slice(0, 60);
            const id = el.id ? `#${el.id}` : '';
            const cls = el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : '';
            const href = el.href || '';
            return `[${i}] <${tag}${id}${cls}> "${text}"${href ? ` href="${href}"` : ''}`;
          });
        }, selector);

        if (elements.length === 0) return `⚠️ 未找到匹配 "${selector}" 的元素`;
        return `✅ 找到 ${elements.length} 个元素（选择器：${selector}）：\n${elements.join('\n')}`;
      }

      // ── wait_for ─────────────────────────────────────────────────────────────
      case 'wait_for': {
        if (!selector) return '❌ wait_for 需要传 selector 参数';
        await pg.waitForSelector(selector, { timeout: 10000 });
        return `✅ 元素已出现：${selector}`;
      }

      default:
        return `❌ 未知 action：${action}`;
    }
  } catch (e: any) {
    const msg: string = e.message || String(e);
    // 超时
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      return `❌ 操作超时：${msg.split('\n')[0]}`;
    }
    // 找不到元素
    if (msg.includes('waiting for') || msg.includes('No element')) {
      return `❌ 找不到元素（可能页面未加载完或选择器有误）：${msg.split('\n')[0]}`;
    }
    return `❌ browser_action 执行失败：${msg.split('\n')[0]}`;
  }
};
