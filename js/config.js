/**
 * アプリ設定 — マスタを用意したら、ここだけ書き換えれば動きます。
 *
 * source:
 *   'local'  … data/index.json + data/<id>.json を読む（マスタ準備前のサンプル用）
 *   'gsheet' … Googleスプレッドシート（毎週シートを追加していく運用）を読む
 */
export const CONFIG = {
  source: 'local',

  gsheet: {
    // スプレッドシートURLの /d/ と /edit の間の文字列
    // 例: https://docs.google.com/spreadsheets/d/【ここ】/edit
    spreadsheetId: '',

    // シート名の自動取得に使う Google Sheets API キー（任意）
    // 設定すると「毎週シートを追加するだけ」でホームの一覧に自動で並びます。
    apiKey: '',

    // apiKey を使わない場合の手動リスト（毎週ここに1行足す）
    // 例: ['Week01', 'Week02']
    sheets: [],

    // 一覧に出したくないシート名（設定シートなど）
    excludeSheets: ['設定', 'config', 'README'],
  },

  // 読み上げ設定
  speech: {
    lang: 'en-US',
    rate: 0.85,   // 子供向けに少しゆっくり
    pitch: 1.0,
  },

  // カードを表示したときに自動で1回読み上げる
  autoSpeak: true,
};
