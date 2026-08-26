import { CONFIG } from './config.js';
import { listSheets, loadCards } from './data.js';
import { lastChoice, session } from './storage.js';
import * as speech from './speech.js';

const $ = (id) => document.getElementById(id);

const el = {
  views: { home: $('view-home'), study: $('view-study'), done: $('view-done') },
  sheetList: $('sheet-list'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  startBtn: $('start-btn'),
  homeError: $('home-error'),
  resumeBox: $('resume-box'),
  resumeInfo: $('resume-info'),
  resumeBtn: $('resume-btn'),
  quitBtn: $('quit-btn'),
  sheetName: $('sheet-name'),
  progress: $('progress'),
  progressFill: $('progress-fill'),
  card: $('card'),
  cardWord: $('card-word'),
  cardJa: $('card-ja'),
  speakBtn: $('speak-btn'),
  speakBtnBack: $('speak-btn-back'),
  flipBtn: $('flip-btn'),
  answerRow: $('answer-row'),
  yesBtn: $('yes-btn'),
  noBtn: $('no-btn'),
  againBtn: $('again-btn'),
  homeBtn: $('home-btn'),
  doneDetail: $('done-detail'),
};

/** カードがめくれ終わるまでの時間（css の .card transition と合わせる） */
const FLIP_MS = 350;

/** 学習中の状態 */
let state = null;
/** 予約中の処理（読み上げ・表示の切り替え） */
let timers = [];
/** ホームでの選択 */
let selected = { sheetId: null, sheetName: null, mode: 'order' };

/* ---------------- 画面切り替え ---------------- */

function showView(name) {
  for (const [key, node] of Object.entries(el.views)) {
    node.classList.toggle('is-active', key === name);
  }
  window.scrollTo(0, 0);
}

/* ---------------- ホーム ---------------- */

async function initHome() {
  showView('home');
  const saved = lastChoice.get();
  if (saved?.mode) setMode(saved.mode);

  try {
    const sheets = await listSheets();
    renderSheetList(sheets, saved?.sheetId);
    renderResume(sheets);
  } catch (err) {
    el.sheetList.innerHTML = '';
    showError(`リストを よみこめませんでした。\n${err.message}`);
  }
}

function renderSheetList(sheets, savedSheetId) {
  el.sheetList.innerHTML = '';
  if (!sheets.length) {
    el.sheetList.innerHTML = '<p class="loading">シートが ありません</p>';
    return;
  }
  for (const sheet of sheets) {
    const btn = document.createElement('button');
    btn.className = 'sheet-btn';
    btn.innerHTML = `<span>${escapeHtml(sheet.name)}</span><span class="check">✅</span>`;
    btn.addEventListener('click', () => selectSheet(sheet, btn));
    el.sheetList.appendChild(btn);
    // 前回えらんだシートを最初から選んでおく
    if (sheet.id === savedSheetId) selectSheet(sheet, btn);
  }
}

function selectSheet(sheet, btn) {
  selected.sheetId = sheet.id;
  selected.sheetName = sheet.name;
  [...el.sheetList.children].forEach((node) => node.classList.toggle('is-on', node === btn));
  el.startBtn.disabled = false;
  hideError();
}

function setMode(mode) {
  selected.mode = mode;
  el.modeBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
}

function renderResume(sheets) {
  const saved = session.get();
  const known = sheets.some((s) => s.id === saved?.sheetId);
  if (!saved || !saved.queue?.length || !known) {
    el.resumeBox.hidden = true;
    return;
  }
  el.resumeBox.hidden = false;
  el.resumeInfo.textContent = `${saved.sheetName} — のこり ${saved.queue.length} まい`;
}

function showError(message) {
  el.homeError.textContent = message;
  el.homeError.hidden = false;
}

function hideError() {
  el.homeError.hidden = true;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 学習の開始 ---------------- */

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function startStudy() {
  if (!selected.sheetId) return;
  speech.unlock();
  el.startBtn.disabled = true;
  el.startBtn.textContent = 'よみこみちゅう…';
  try {
    const cards = await loadCards(selected.sheetId);
    if (!cards.length) throw new Error('たんごが ありませんでした');
    state = {
      sheetId: selected.sheetId,
      sheetName: selected.sheetName,
      mode: selected.mode,
      total: cards.length,
      learned: 0,
      queue: selected.mode === 'random' ? shuffle(cards) : cards,
    };
    lastChoice.set(state.sheetId, state.mode);
    session.set(state);
    enterStudy();
  } catch (err) {
    showError(`よみこめませんでした。\n${err.message}`);
  } finally {
    el.startBtn.disabled = false;
    el.startBtn.textContent = 'はじめる 🚀';
  }
}

function resumeStudy() {
  const saved = session.get();
  if (!saved?.queue?.length) return;
  speech.unlock();
  state = saved;
  enterStudy();
}

function enterStudy() {
  showView('study');
  el.sheetName.textContent = state.sheetName;
  showCard({ speak: CONFIG.autoSpeak });
}

/* ---------------- カード表示 ---------------- */

function currentCard() {
  return state?.queue[0] || null;
}

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

/** 予約ずみの読み上げ・表示をとりやめる（連打や中断のとき） */
function cancelPending() {
  timers.forEach(clearTimeout);
  timers = [];
}

function showCard({ speak: doSpeak = false, afterFlip = false } = {}) {
  cancelPending();
  speech.stop();

  const card = currentCard();
  if (!card) return finish();

  setFlipped(false);
  const render = () => {
    el.cardWord.textContent = card.word;
    el.cardJa.textContent = card.ja || '';
    el.cardJa.hidden = !card.ja;
  };
  // 裏返っている途中に次の単語が見えてしまわないよう、半分回ってから差し替える
  if (afterFlip) later(render, FLIP_MS / 2);
  else render();

  updateProgress();
  if (doSpeak) later(speakCurrent, CONFIG.autoSpeakDelay);
}

function setFlipped(flipped) {
  el.card.classList.toggle('is-flipped', flipped);
  el.flipBtn.hidden = flipped;
  el.answerRow.hidden = !flipped;
}

function updateProgress() {
  const remaining = state.queue.length;
  el.progress.textContent = `のこり ${remaining}`;
  const done = Math.max(0, state.total - remaining);
  el.progressFill.style.width = `${Math.round((done / state.total) * 100)}%`;
}

function speakCurrent() {
  const card = currentCard();
  if (!card) return;
  speech.speak(card.word, {
    onStart: () => el.speakBtn.classList.add('is-speaking'),
    onEnd: () => el.speakBtn.classList.remove('is-speaking'),
  });
}

/* ---------------- 回答 ---------------- */

function answer(known) {
  if (!state?.queue.length) return;
  const card = state.queue.shift();
  if (known) {
    state.learned++;
  } else {
    state.queue.push(card); // 「まだ」は最後にまわして あとで もういちど
  }
  session.set(state);

  if (!state.queue.length) return finish();
  showCard({ speak: CONFIG.autoSpeak, afterFlip: true });
}

function finish() {
  cancelPending();
  speech.stop();
  session.clear();
  el.doneDetail.textContent = `${state.sheetName} / ${state.total} まい`;
  showView('done');
}

function quitStudy() {
  cancelPending();
  speech.stop();
  session.set(state); // 途中でやめても「つづきから」で戻れる
  state = null;
  initHome();
}

/* ---------------- イベント ---------------- */

el.modeBtns.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
el.startBtn.addEventListener('click', startStudy);
el.resumeBtn.addEventListener('click', resumeStudy);
el.quitBtn.addEventListener('click', quitStudy);
el.speakBtn.addEventListener('click', (e) => {
  e.stopPropagation(); cancelPending(); speech.unlock(); speakCurrent();
});
el.speakBtnBack.addEventListener('click', (e) => {
  e.stopPropagation(); cancelPending(); speakCurrent();
});
el.flipBtn.addEventListener('click', () => setFlipped(true));
el.card.addEventListener('click', () => { if (!el.card.classList.contains('is-flipped')) setFlipped(true); });
el.yesBtn.addEventListener('click', () => answer(true));
el.noBtn.addEventListener('click', () => answer(false));
el.againBtn.addEventListener('click', () => { selected.sheetId = state.sheetId; selected.sheetName = state.sheetName; startStudy(); });
el.homeBtn.addEventListener('click', () => { state = null; initHome(); });

initHome();
