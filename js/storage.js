/** localStorage ラッパー（プライベートブラウズ等で失敗しても落ちないようにする） */
const PREFIX = 'swc:';

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (_) { /* 保存できなくても学習は続けられる */ }
}

function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (_) { /* noop */ }
}

/** 最後に選んだシートとモード */
export const lastChoice = {
  get: () => read('lastChoice'),
  set: (sheetId, mode) => write('lastChoice', { sheetId, mode }),
};

/** トップページで選んだ読み上げの速さ */
export const speed = {
  get: () => read('speed'),
  set: (rate) => write('speed', rate),
};

/** トップページで選んだ声の名前（未選択なら自動） */
export const voiceName = {
  get: () => read('voiceName'),
  set: (name) => write('voiceName', name),
};

/** 学習の途中状態（リロード・アプリ再訪時の「つづきから」用） */
export const session = {
  get: () => read('session'),
  set: (state) => write('session', state),
  clear: () => remove('session'),
};

/** 写真取り込み用のキー（この端末だけに保存。サーバーには送らない） */
export const scanKeys = {
  get: () => read('scanKeys') || { anthropic: '', github: '' },
  set: (keys) => write('scanKeys', keys),
};

/**
 * 写真から登録した直後のシート。
 * GitHub Pages に反映されるまで（1〜2分）、この端末ではすぐ使えるように控えておく。
 * [{ id, name, cards, savedAt }]
 */
export const pendingSheets = {
  get: () => read('pendingSheets') || [],
  set: (list) => write('pendingSheets', list),
  add(sheet) {
    const list = pendingSheets.get().filter((s) => s.id !== sheet.id);
    list.push(sheet);
    write('pendingSheets', list);
  },
};
