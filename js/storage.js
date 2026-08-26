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

/** 学習の途中状態（リロード・アプリ再訪時の「つづきから」用） */
export const session = {
  get: () => read('session'),
  set: (state) => write('session', state),
  clear: () => remove('session'),
};
