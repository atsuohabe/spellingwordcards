/** Web Speech API による発音再生（音声ファイル不要・オフラインでも動く） */
import { CONFIG } from './config.js';

const synth = window.speechSynthesis;
let voice = null;
let unlocked = false;

export const isSupported = !!synth;

function pickVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const lang = CONFIG.speech.lang.toLowerCase();
  const base = lang.split('-')[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === lang && v.localService) ||
    voices.find((v) => v.lang.toLowerCase() === lang) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
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
    if (voice) u.voice = voice;
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
