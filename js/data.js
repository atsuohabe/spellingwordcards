/**
 * マスタ読み込み。
 * データソースは config.js の source で切り替える（local / gsheet）。
 * どちらのモードでも返す形は同じ:
 *   listSheets() -> [{ id, name }]
 *   loadCards(sheetId) -> [{ word, ja }]
 */
import { CONFIG } from './config.js?v=2026-08-27a';

const WORD_KEYS = ['word', 'words', 'english', 'spelling', 'eng', '英語', 'えいご', 'たんご', '単語', 'スペル'];
const JA_KEYS = ['ja', 'japanese', 'jp', 'translation', 'meaning', 'mean',
                 '日本語', 'にほんご', '訳', 'やく', 'いみ', '意味', 'ほんやく', '翻訳'];

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

/** 値が英単語らしいか（ASCIIの英字が中心か） */
function looksEnglish(value) {
  const v = String(value ?? '').trim();
  return !!v && /^[A-Za-z][A-Za-z'’\- ]*$/.test(v);
}

/** 値に日本語（かな・漢字）が含まれるか */
function looksJapanese(value) {
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(String(value ?? ''));
}

/** 列ごとに、条件に当てはまる行の割合を数える */
function ratio(rows, index, test) {
  const values = rows.map((r) => r[index]).filter((v) => String(v ?? '').trim() !== '');
  if (!values.length) return 0;
  return values.filter(test).length / values.length;
}

/**
 * 「英語」「日本語」列の位置を決める。
 * 1) ヘッダー名で判定 → 2) 中身で判定（No. のような番号列を拾わないように）
 */
function detectColumns(headers, rows) {
  const norm = headers.map(normalizeHeader);
  let word = norm.findIndex((h) => WORD_KEYS.includes(h));
  let ja = norm.findIndex((h) => JA_KEYS.includes(h));
  const columnCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);

  if (word < 0) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < columnCount; i++) {
      if (i === ja) continue;
      const score = ratio(rows, i, looksEnglish);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    word = bestScore >= 0.5 ? best : 0;
  }
  if (ja < 0) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < columnCount; i++) {
      if (i === word) continue;
      const score = ratio(rows, i, looksJapanese);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    ja = bestScore >= 0.5 ? best : -1; // 見つからなければ訳なし（裏面は英語だけ）
  }
  return { word, ja };
}

/** 行の配列 -> カード配列。空行・重複は捨てる */
function rowsToCards(headers, rows) {
  const col = detectColumns(headers, rows);
  const seen = new Set();
  const cards = [];
  for (const row of rows) {
    const word = String(row[col.word] ?? '').trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ word, ja: col.ja < 0 ? '' : String(row[col.ja] ?? '').trim() });
  }
  return cards;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
  return res.json();
}

/** スプレッドシートのURL（またはID）からIDを取り出す */
function resolveSpreadsheetId() {
  const { spreadsheetUrl, spreadsheetId } = CONFIG.gsheet;
  const fromUrl = String(spreadsheetUrl || '').match(/\/d\/([A-Za-z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : String(spreadsheetId || '').trim();
  if (!id) throw new Error('config.js に spreadsheetUrl（またはspreadsheetId）を設定してください');
  return id;
}

/** つまずきやすい失敗を、原因が分かるメッセージにする */
function describeSheetError(status, id) {
  if (status === 403) {
    return 'スプレッドシートを読む権限がありません。\n' +
      '・共有設定が「リンクを知っている全員が閲覧可」になっているか\n' +
      '・APIキーのリファラー制限に、このページのURLが入っているか\nを確認してください。';
  }
  if (status === 404) {
    const hint = id.length < 40
      ? '\nこのIDは、アップロードした .xlsx ファイルのものかもしれません。' +
        '\nスプレッドシートで「ファイル → Googleスプレッドシートとして保存」をして、' +
        '\n新しく作られたファイルのURLを設定してください。'
      : '';
    return `スプレッドシートが見つかりません。URL（ID）を確認してください。${hint}`;
  }
  if (status === 400) return 'APIキーが正しくないようです。config.js の apiKey を確認してください。';
  return `スプレッドシートを読み込めませんでした (${status})`;
}

/* ---------------- local ---------------- */

const local = {
  async listSheets() {
    const data = await fetchJson('data/index.json');
    const sheets = Array.isArray(data) ? data : data.sheets || [];
    return sheets.map((s) => (typeof s === 'string' ? { id: s, name: s } : { id: s.id, name: s.name || s.id }));
  },
  async loadCards(sheetId) {
    const data = await fetchJson(`data/${encodeURIComponent(sheetId)}.json`);
    const rows = Array.isArray(data) ? data : data.cards || [];
    if (!rows.length) return [];
    if (Array.isArray(rows[0])) return rowsToCards(rows[0], rows.slice(1));
    // [{ word, ja }, ...] 形式
    const headers = Object.keys(rows[0]);
    return rowsToCards(headers, rows.map((r) => headers.map((h) => r[h])));
  },
};

/* ---------------- Google スプレッドシート ---------------- */

/** Sheets API v4（APIキーあり）: シートの中身をそのまま取得 */
function valuesUrl(spreadsheetId, sheetName, apiKey) {
  const range = encodeURIComponent(`'${String(sheetName).replace(/'/g, "''")}'`);
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}` +
    `?majorDimension=ROWS&key=${apiKey}`;
}

/** gviz（APIキーなし）: 公開シートを直接読む */
function gvizUrl(spreadsheetId, sheetName) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
}

/** gviz の応答（JSONP風）から JSON を取り出す */
function parseGviz(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('スプレッドシートの応答を読めませんでした');
  return JSON.parse(text.slice(start, end + 1));
}

const gsheet = {
  async listSheets() {
    const { apiKey, sheets, excludeSheets } = CONFIG.gsheet;
    const spreadsheetId = resolveSpreadsheetId();

    let names = sheets || [];
    if (apiKey) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
        `?fields=sheets.properties.title&key=${apiKey}`;
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(describeSheetError(res.status, spreadsheetId));
      const data = await res.json();
      names = (data.sheets || []).map((s) => s.properties.title);
    }
    const exclude = new Set((excludeSheets || []).map(normalizeHeader));
    return names
      .filter((n) => n && !exclude.has(normalizeHeader(n)))
      .map((n) => ({ id: n, name: n }));
  },

  async loadCards(sheetName) {
    const spreadsheetId = resolveSpreadsheetId();
    const { apiKey } = CONFIG.gsheet;
    const res = await fetch(
      apiKey ? valuesUrl(spreadsheetId, sheetName, apiKey) : gvizUrl(spreadsheetId, sheetName),
      { cache: 'no-cache' },
    );
    if (!res.ok) throw new Error(describeSheetError(res.status, spreadsheetId));

    if (apiKey) {
      const values = (await res.json()).values || [];
      return values.length ? rowsToCards(values[0], values.slice(1)) : [];
    }
    const table = parseGviz(await res.text()).table;
    const headers = (table.cols || []).map((c) => c.label || c.id);
    const rows = (table.rows || []).map((r) => (r.c || []).map((c) => (c ? c.f ?? c.v : '')));
    return rowsToCards(headers, rows);
  },
};

const source = CONFIG.source === 'gsheet' ? gsheet : local;

export const listSheets = () => source.listSheets();
export const loadCards = (sheetId) => source.loadCards(sheetId);
