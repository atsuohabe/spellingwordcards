/**
 * 📷 写真から単語カードを作る画面。
 *   1. 写真を選ぶ → Claude が英単語を読み取り、訳をつける
 *   2. 確認・修正（単語ごとに訳のつけ直し・手で修正・追加・削除・並べかえ）
 *   3. 登録 → マスタの xlsx に新しいシート（Vol.N）を足し、data/*.json と一緒に GitHub へコミット
 */
import { CONFIG } from './config.js?v=2026-11-07a';
import { listSheets } from './data.js?v=2026-11-07a';
import { scanKeys, pendingSheets } from './storage.js?v=2026-11-07a';
import { scanImage, retranslate, normalizeWord } from './ai.js?v=2026-11-07a';
import { createClient, GitHubError } from './github.js?v=2026-11-07a';
import { appendSheet, listSheetNames } from './xlsx.js?v=2026-11-07a';
import * as speech from './speech.js?v=2026-11-07a';

const $ = (id) => document.getElementById(id);

const el = {
  backBtn: $('scan-back-btn'),
  keysBox: $('scan-keys'),
  anthropicKey: $('scan-anthropic-key'),
  githubToken: $('scan-github-token'),
  saveKeysBtn: $('scan-save-keys'),
  keysStatus: $('scan-keys-status'),
  stepPhoto: $('scan-step-photo'),
  fileInput: $('scan-file'),
  pickBtn: $('scan-pick-btn'),
  preview: $('scan-preview'),
  readBtn: $('scan-read-btn'),
  stepReview: $('scan-step-review'),
  title: $('scan-title'),
  sheetName: $('scan-sheet-name'),
  rows: $('scan-rows'),
  addBtn: $('scan-add-btn'),
  retakeBtn: $('scan-retake-btn'),
  saveBtn: $('scan-save-btn'),
  stepDone: $('scan-step-done'),
  doneText: $('scan-done-text'),
  studyBtn: $('scan-study-btn'),
  homeBtn: $('scan-home-btn'),
  status: $('scan-status'),
  error: $('scan-error'),
};

/** 写真の長い辺をこの大きさにそろえる（文字が読めて、送るデータが重くなりすぎない大きさ） */
const MAX_EDGE = 1800;

let ctx = null;        // app.js から渡されるもの { showView, goHome, startSheet }
let image = null;      // { base64, mediaType }
let words = [];        // [{ word, ja, busy }]
let autoName = '';     // 自動で決めたシート名（手で変えていなければ、保存時に空き番号へずらす）
let busy = false;

/* ---------------- 入口 ---------------- */

export function initScan(context) {
  ctx = context;

  el.backBtn.addEventListener('click', () => { if (!busy) ctx.goHome(); });
  el.homeBtn.addEventListener('click', () => ctx.goHome());
  el.saveKeysBtn.addEventListener('click', saveKeys);
  el.pickBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', onFileChosen);
  el.readBtn.addEventListener('click', readPhoto);
  el.addBtn.addEventListener('click', () => {
    words.push({ word: '', ja: '' });
    renderRows();
    el.rows.querySelector('.scan-row:last-child .scan-word')?.focus();
  });
  el.retakeBtn.addEventListener('click', () => {
    if (words.length && !confirm('読み取った内容を消して、写真を選び直しますか？')) return;
    resetToPhoto();
  });
  el.saveBtn.addEventListener('click', save);
}

export function openScan() {
  ctx.showView('scan');
  hideError();
  setStatus('');
  const keys = scanKeys.get();
  el.anthropicKey.value = keys.anthropic || '';
  el.githubToken.value = keys.github || '';
  // キーが未設定なら、最初に設定欄を開いておく
  el.keysBox.open = !(keys.anthropic && keys.github);
  updateKeysStatus();
  if (!el.stepDone.hidden) resetToPhoto();
}

/* ---------------- キーの設定 ---------------- */

function saveKeys() {
  scanKeys.set({ anthropic: el.anthropicKey.value.trim(), github: el.githubToken.value.trim() });
  updateKeysStatus();
  el.keysBox.open = false;
}

function updateKeysStatus() {
  const keys = scanKeys.get();
  const mark = (v) => (v ? '✅' : '⚠️ 未設定');
  el.keysStatus.textContent = `Claude: ${mark(keys.anthropic)} / GitHub: ${mark(keys.github)}`;
}

function requireKeys(...names) {
  const keys = scanKeys.get();
  const missing = names.filter((n) => !keys[n]);
  if (missing.length) {
    el.keysBox.open = true;
    const label = { anthropic: 'Claude の API キー', github: 'GitHub のトークン' };
    throw new Error(`${missing.map((n) => label[n]).join('と')}を「⚙️ 設定」に入れてください。`);
  }
  return keys;
}

/* ---------------- 1. 写真 ---------------- */

function resetToPhoto() {
  image = null;
  words = [];
  el.fileInput.value = '';
  el.preview.hidden = true;
  el.preview.removeAttribute('src');
  el.readBtn.disabled = true;
  el.stepPhoto.hidden = false;
  el.stepReview.hidden = true;
  el.stepDone.hidden = true;
  hideError();
  setStatus('');
}

async function onFileChosen() {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  hideError();
  setStatus('写真を準備しています…');
  try {
    image = await prepareImage(file);
    el.preview.src = `data:${image.mediaType};base64,${image.base64}`;
    el.preview.hidden = false;
    el.readBtn.disabled = false;
    setStatus('');
  } catch (err) {
    image = null;
    el.readBtn.disabled = true;
    setStatus('');
    showError(err.message);
  }
}

/** どんな写真でも（iPhone の HEIC も）JPEG に変換し、大きすぎれば縮める */
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('この写真の形式は、このブラウザでは開けませんでした。JPEG か PNG で試してください。'));
      node.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPhoto() {
  if (!image || busy) return;
  hideError();
  try {
    const keys = requireKeys('anthropic');
    setBusy(true, '📖 Claude が写真を読んでいます…（30秒ほどかかります）');
    const result = await scanImage(keys.anthropic, image);
    if (!result.words.length) throw new Error('写真から英単語が見つかりませんでした。明るい場所で、プリント全体が写るように撮り直してください。');
    words = result.words;
    el.title.textContent = result.title ? `📄 ${result.title}` : '';
    el.title.hidden = !result.title;
    autoName = await nextSheetName();
    el.sheetName.value = autoName;
    renderRows();
    el.stepPhoto.hidden = true;
    el.stepReview.hidden = false;
    window.scrollTo(0, 0);
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

/* ---------------- 2. 確認・修正 ---------------- */

function renderRows() {
  el.rows.innerHTML = '';
  words.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'scan-row';

    const no = document.createElement('span');
    no.className = 'word-no';
    no.textContent = String(index + 1);

    const fields = document.createElement('div');
    fields.className = 'scan-fields';
    const word = document.createElement('input');
    word.className = 'scan-word';
    word.type = 'text';
    word.value = item.word;
    word.placeholder = 'English';
    word.autocapitalize = 'off';
    word.autocomplete = 'off';
    word.spellcheck = false;
    word.setAttribute('aria-label', `${index + 1} English word`);
    word.addEventListener('input', () => { item.word = word.value; });
    word.addEventListener('change', () => { item.word = normalizeWord(word.value); word.value = item.word; });

    const ja = document.createElement('input');
    ja.className = 'scan-ja';
    ja.type = 'text';
    ja.value = item.ja;
    ja.placeholder = '日本語の訳';
    ja.setAttribute('aria-label', `${index + 1} 日本語の訳`);
    ja.addEventListener('input', () => { item.ja = ja.value; });
    fields.append(word, ja);

    const tools = document.createElement('div');
    tools.className = 'scan-tools';
    tools.append(
      tool('🔊', `${item.word} を聞く`, () => {
        speech.unlock();
        if (item.word.trim()) speech.speak(item.word.trim());
      }),
      tool(item.busy ? '⏳' : '🔄', '訳をつけ直す', () => redoTranslation(item), item.busy),
      tool('↑', '上へ', () => move(index, -1), index === 0),
      tool('↓', '下へ', () => move(index, 1), index === words.length - 1),
      tool('✕', '削除', () => {
        if (!item.word.trim() || confirm(`「${item.word}」を消しますか？`)) {
          words.splice(index, 1);
          renderRows();
        }
      }),
    );

    row.append(no, fields, tools);
    el.rows.appendChild(row);
  });
  el.saveBtn.textContent = `✅ ${words.length}語を登録する`;
}

function tool(label, aria, onClick, disabled = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'scan-tool';
  btn.textContent = label;
  btn.disabled = disabled;
  btn.setAttribute('aria-label', aria);
  btn.addEventListener('click', onClick);
  return btn;
}

function move(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= words.length) return;
  [words[index], words[to]] = [words[to], words[index]];
  renderRows();
}

async function redoTranslation(item) {
  hideError();
  const word = normalizeWord(item.word);
  if (!word) return showError('先に英単語を入れてください。');
  try {
    const keys = requireKeys('anthropic');
    item.busy = true;
    renderRows();
    const others = words.filter((w) => w !== item).map((w) => normalizeWord(w.word)).filter(Boolean);
    item.ja = await retranslate(keys.anthropic, { word, current: item.ja.trim(), others });
  } catch (err) {
    showError(err.message);
  } finally {
    item.busy = false;
    renderRows();
  }
}

/** 登録できる形に整える（空行を捨て、同じ単語の2回目以降はエラーにする） */
function cleanWords() {
  const cards = [];
  const seen = new Map();
  for (const w of words) {
    const word = normalizeWord(w.word);
    if (!word) continue;
    if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(word)) {
      throw new Error(`「${word}」に英字以外の文字が入っています。直してから登録してください。`);
    }
    const key = word.toLowerCase();
    if (seen.has(key)) throw new Error(`「${word}」が2回入っています（${seen.get(key)}番と${cards.length + 1}番）。どちらかを消してください。`);
    seen.set(key, cards.length + 1);
    cards.push({ word, ja: String(w.ja || '').trim() });
  }
  if (!cards.length) throw new Error('登録する単語がありません。');
  return cards;
}

/* ---------------- シート名（並び番号） ---------------- */

/** Vol.1, Vol.2 … のいちばん大きい番号の次 */
function nextNameFrom(names) {
  const prefix = CONFIG.scan.sheetPrefix;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\d+)$`, 'i');
  const max = Math.max(0, ...names.map((n) => Number((String(n).trim().match(re) || [])[1]) || 0));
  return `${prefix}${max + 1}`;
}

async function nextSheetName() {
  try {
    return nextNameFrom((await listSheets()).map((s) => s.name));
  } catch (_) {
    return `${CONFIG.scan.sheetPrefix}1`;
  }
}

/** tools/xlsx_to_json.py の make_id と同じ規則で、シート名からファイル名用の ID を作る */
function makeId(name, used, position) {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!/[a-z]/.test(base)) {
    const digits = base.replace(/[^0-9]/g, '');
    base = digits ? `sheet${digits}` : `sheet${position}`;
  }
  let candidate = base;
  for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/* ---------------- 3. 登録 ---------------- */

async function save() {
  if (busy) return;
  hideError();
  let cards;
  let name = el.sheetName.value.trim();
  try {
    cards = cleanWords();
    if (!name) throw new Error('シート名を入れてください（例: Vol.11）。');
    if (/[\\/?*[\]:]/.test(name) || name.length > 31) {
      throw new Error('シート名に \\ / ? * [ ] : は使えません（31文字まで）。');
    }
    requireKeys('github');
  } catch (err) {
    return showError(err.message);
  }

  const keys = scanKeys.get();
  const gh = createClient({ token: keys.github, ...CONFIG.scan.github });
  setBusy(true, '💾 マスタに登録しています…');
  try {
    let result = null;
    for (let attempt = 1; !result; attempt++) {
      try {
        result = await commitSheet(gh, name, cards);
      } catch (err) {
        // 同じタイミングで別の更新が入ったときは、最新の状態からもう一度だけやり直す
        if (err instanceof GitHubError && (err.status === 409 || err.status === 422) && attempt < 3) continue;
        throw err;
      }
    }
    name = result.name;
    pendingSheets.add({ id: result.id, name, cards, savedAt: Date.now() });
    el.doneText.textContent = `「${name}」に ${cards.length} 語を登録しました。\n` +
      'この端末ではすぐに使えます。ほかの端末には1〜2分で反映されます。';
    el.stepReview.hidden = true;
    el.stepDone.hidden = false;
    el.studyBtn.onclick = () => ctx.startSheet({ id: result.id, name });
    window.scrollTo(0, 0);
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

async function commitSheet(gh, requestedName, cards) {
  const { xlsxPath } = CONFIG.scan.github;
  const snap = await gh.snapshot();
  const xlsx = await gh.readFile(snap, xlsxPath);
  if (!xlsx) throw new Error(`GitHub に ${xlsxPath} が見つかりません。`);

  // 自動で決めた名前のままなら、マスタの実際のシートを見て空き番号にそろえる
  const names = await listSheetNames(xlsx);
  let name = requestedName;
  if (name === autoName) name = nextNameFrom(names);
  if (names.some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw new Error(`「${name}」という名前のシートは、もうマスタにあります。別の名前にしてください。`);
  }
  const newXlsx = await appendSheet(xlsx, name, cards);

  // アプリが読む data/*.json も同じコミットで更新する（Actions の変換結果と同じ形）
  const indexBytes = await gh.readFile(snap, 'data/index.json');
  const index = indexBytes ? JSON.parse(new TextDecoder().decode(indexBytes)) : { sheets: [] };
  const sheets = Array.isArray(index) ? index : index.sheets || [];
  const id = makeId(name, new Set(sheets.map((s) => s.id || s)), names.length + 1);
  sheets.push({ id, name });

  const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
  await gh.commit(snap, [
    { path: xlsxPath, bytes: newXlsx },
    { path: `data/${id}.json`, text: json({ cards }) },
    { path: 'data/index.json', text: json({ sheets }) },
  ], `写真から単語カードを追加: ${name}（${cards.length}語）`);
  return { id, name };
}

/* ---------------- 表示 ---------------- */

function setBusy(on, message = '') {
  busy = on;
  el.readBtn.disabled = on || !image;
  el.saveBtn.disabled = on;
  el.pickBtn.disabled = on;
  el.retakeBtn.disabled = on;
  setStatus(on ? message : '');
}

function setStatus(message) {
  el.status.textContent = message;
  el.status.hidden = !message;
}

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = false;
  el.error.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function hideError() {
  el.error.hidden = true;
}
