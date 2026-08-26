/** Web Speech API による発音再生（音声ファイル不要・オフラインでも動く） */
import { CONFIG } from './config.js';

const synth = window.speechSynthesis;
let voice = null;
let unlocked = false;

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
    if (order >= 0) score += 60 - order;                              // 指定した順に優先
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

if (synth) {
  voice = pickVoice();
  // iOS / Chrome は音声リストが非同期で届く
  synth.addEventListener?.('voiceschanged', () => { voice = pickVoice(); });
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
    u.rate = CONFIG.speech.rate;
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
