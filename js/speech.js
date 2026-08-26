/** Web Speech API による発音再生（音声ファイル不要・オフラインでも動く） */
import { CONFIG } from './config.js?v=2026-08-27c';

const synth = window.speechSynthesis;
let voice = null;
let unlocked = false;
let rateOverride = null;   // 画面で選ばれた速さ（未選択なら config の値を使う）

export const isSupported = !!synth;

/** 高品質な声につく名前（端末によって呼び方が違う） */
const QUALITY_HINTS = ['enhanced', 'premium', 'neural', 'natural', 'siri'];

/** いちばん聞き取りやすそうな声を選ぶ */
function pickVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;

  const lang = CONFIG.speech.lang.toLowerCase();
  const base = lang.split('-')[0];
  const candidates = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base));
  if (!candidates.length) return null;

  const preferred = (CONFIG.speech.preferVoices || []).map((n) => n.toLowerCase());
  const rank = (voice) => {
    const name = voice.name.toLowerCase();
    let score = 0;
    if (voice.lang.toLowerCase().replace('_', '-') === lang) score += 100;
    const order = preferred.findIndex((p) => name.includes(p));
    if (order >= 0) score += 1000 - order * 100;  // preferVoices の順番をいちばん優先
    if (voice.default) score += 80;               // 次に、端末の設定で選ばれている声
    if (QUALITY_HINTS.some((hint) => name.includes(hint))) score += 40; // 高品質版があれば優先
    if (voice.localService) score += 5;                                // 端末内の声は途切れない
    return score;
  };
  return [...candidates].sort((a, b) => rank(b) - rank(a))[0];
}

/** いま使っている声（設定の確認用） */
export function currentVoice() {
  if (!voice) voice = pickVoice();
  return voice ? { name: voice.name, lang: voice.lang, local: voice.localService } : null;
}

/** 声が決まった／変わったときに知らせる相手 */
const listeners = [];

function notify() {
  listeners.forEach((cb) => cb(currentVoice()));
}

/** いま使う声が決まったら教えてもらう（登録時にも1回呼ばれる） */
export function onVoiceChange(callback) {
  listeners.push(callback);
  callback(currentVoice());
}

/** 声を選び直す（iPhoneの設定を変えて戻ってきたときなど） */
export function refreshVoice() {
  const before = voice;
  voice = pickVoice();
  if (voice !== before) notify();
}

/** 読み上げの速さを変える */
export function setRate(rate) {
  rateOverride = rate;
}

export function getRate() {
  return rateOverride ?? CONFIG.speech.rate;
}

if (synth) {
  voice = pickVoice();
  // iOS / Chrome は音声リストが非同期で届く。あとから増えることもある
  synth.addEventListener?.('voiceschanged', () => { voice = pickVoice(); notify(); });
}

/**
 * iOS Safari は「ユーザー操作の中で1度 speak する」までは音が出ない。
 * 最初のタップで無音の発話を流して解除しておく。
 */
export function unlock() {
  if (!synth || unlocked) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    synth.speak(u);
  } catch (_) { /* noop */ }
}

/**
 * 英単語を読み上げる
 * @param {string} text
 * @param {{onStart?:Function, onEnd?:Function}} [handlers]
 */
export function speak(text, handlers = {}) {
  if (!synth || !text) return;
  try {
    synth.cancel(); // 連打しても重ならないように
    const u = new SpeechSynthesisUtterance(text);
    u.lang = CONFIG.speech.lang;
    u.rate = getRate();
    u.pitch = CONFIG.speech.pitch;
    if (!voice) voice = pickVoice();
    // 声の割り当てに失敗しても、既定の声で必ず再生されるようにする
    if (voice) {
      try { u.voice = voice; } catch (_) { voice = null; }
    }
    if (handlers.onStart) u.onstart = handlers.onStart;
    if (handlers.onEnd) {
      u.onend = handlers.onEnd;
      u.onerror = handlers.onEnd;
    }
    synth.speak(u);
  } catch (_) { /* 端末が対応していない場合は無視 */ }
}

export function stop() {
  try { synth?.cancel(); } catch (_) { /* noop */ }
}
