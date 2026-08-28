/** Web Speech API による発音再生（音声ファイル不要・オフラインでも動く） */
import { CONFIG } from './config.js?v=2026-08-28a';

const synth = window.speechSynthesis;
let voice = null;
let unlocked = false;
let rateOverride = null;   // 画面で選ばれた速さ（未選択なら config の値を使う）
let requestId = 0;         // 最後に頼まれた再生だけを鳴らすための番号
let voiceNameOverride = null;   // 画面で選ばれた声の名前（未選択なら自動）

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

  // 画面で声が選ばれていれば、それをそのまま使う
  if (voiceNameOverride) {
    const chosen = candidates.find((v) => v.name === voiceNameOverride);
    if (chosen) return chosen;
  }

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

/** 使える英語の声の一覧（おすすめ順） */
export function listVoices() {
  if (!synth) return [];
  const base = CONFIG.speech.lang.toLowerCase().split('-')[0];
  return synth.getVoices()
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base))
    .map((v) => ({ name: v.name, lang: v.lang }));
}

/** 使う声を指定する（null なら自動で選ぶ） */
export function setVoiceName(name) {
  voiceNameOverride = name || null;
  voice = pickVoice();
  notify();
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

  const rate = getRate();   // 待ってから鳴らす場合も、押したときの速さで再生する
  const id = ++requestId;
  const start = () => {
    if (id !== requestId) return;   // 待っている間に次の再生を頼まれていたら、古い方はやめる
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (!voice) voice = pickVoice();
      // 声を先に決めてから、速さを設定する。
      // WebKit では voice を代入したときに rate が既定値へ戻ることがあるため、
      // 順序を逆にすると「声は合っているのに速さが効かない」状態になる。
      if (voice) {
        try { u.voice = voice; } catch (_) { voice = null; }
      }
      u.lang = CONFIG.speech.lang;
      u.rate = rate;
      u.pitch = CONFIG.speech.pitch;
      if (handlers.onStart) u.onstart = handlers.onStart;
      if (handlers.onEnd) {
        u.onend = handlers.onEnd;
        u.onerror = handlers.onEnd;
      }
      // iOS は cancel のあと一時停止状態のまま残ることがある
      if (synth.paused) synth.resume();
      synth.speak(u);
    } catch (_) { /* 端末が対応していない場合は無視 */ }
  };

  try {
    if (synth.speaking || synth.pending) {
      // iOS は cancel した直後の speak を取りこぼすので、少し待ってから鳴らす
      synth.cancel();
      setTimeout(start, 150);
    } else {
      start();
    }
  } catch (_) { /* noop */ }
}

export function stop() {
  try { synth?.cancel(); } catch (_) { /* noop */ }
}
