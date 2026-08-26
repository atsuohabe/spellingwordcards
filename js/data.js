/**
 * マスタ読み込み。
 * データソースは config.js の source で切り替える（local / gsheet）。
 * どちらのモードでも返す形は同じ:
 *   listSheets() -> [{ id, name }]
 *   loadCards(sheetId) -> [{ word, ja }]
 */
import { CONFIG } from './config.js';

const WORD_KEYS = ['word', 'english', 'spelling', 'eng', '英語', 'えいご', 'たんご', '単語', 'スペル'];
const JA_KEYS = ['ja', 'japanese', 'jp', 'meaning', '日本語', 'にほんご', '訳', 'いみ', '意味'];

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

/** ヘッダー行から「英語」「日本語」列の位置を決める（見つからなければ 1列目/2列目） */
function detectColumns(headers) {
  const norm = headers.map(normalizeHeader);
  let word = norm.findIndex((h) => WORD_KEYS.includes(h));
  let ja = norm.findIndex((h) => JA_KEYS.includes(h));
  if (word < 0) word = 0;
  if (ja < 0) ja = word === 0 ? 1 : 0;
  return { word, ja };
}

/** 行の配列 -> カード配列。空行・重複は捨てる */
function rowsToCards(headers, rows) {
  const col = detectColumns(headers);
  const seen = new Set();
  const cards = [];
  for (const row of rows) {
    const word = String(row[col.word] ?? '').trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ word, ja: String(row[col.ja] ?? '').trim() });
  }
  return cards;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
  return res.json();
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

/** gviz の応答（JSONP風）から JSON を取り出す */
function parseGviz(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('スプレッドシートの応答を読めませんでした');
  return JSON.parse(text.slice(start, end + 1));
}

const gsheet = {
  async listSheets() {
    const { spreadsheetId, apiKey, sheets, excludeSheets } = CONFIG.gsheet;
    if (!spreadsheetId) throw new Error('config.js に spreadsheetId を設定してください');

    let names = sheets || [];
    if (apiKey) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
        `?fields=sheets.properties.title&key=${apiKey}`;
      const data = await fetchJson(url);
      names = (data.sheets || []).map((s) => s.properties.title);
    }
    const exclude = new Set((excludeSheets || []).map(normalizeHeader));
    return names
      .filter((n) => n && !exclude.has(normalizeHeader(n)))
      .map((n) => ({ id: n, name: n }));
  },

  async loadCards(sheetName) {
    const { spreadsheetId } = CONFIG.gsheet;
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` +
      `?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`シートを読み込めませんでした (${res.status})`);
    const table = parseGviz(await res.text()).table;
    const headers = (table.cols || []).map((c) => c.label || c.id);
    const rows = (table.rows || []).map((r) => (r.c || []).map((c) => (c ? c.f ?? c.v : '')));
    return rowsToCards(headers, rows);
  },
};

const source = CONFIG.source === 'gsheet' ? gsheet : local;

export const listSheets = () => source.listSheets();
export const loadCards = (sheetId) => source.loadCards(sheetId);
