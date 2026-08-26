/**
 * アプリ設定 — ここだけ書き換えれば動きます。
 *
 * source:
 *   'local'  … data/index.json + data/<id>.json を読む（xlsxから変換した控え / オフライン可）
 *   'gsheet' … Googleスプレッドシート（毎週シートを追加していく運用）を読む
 *
 * ▼ Googleスプレッドシート運用への切り替えは次の3か所だけ
 *   1. source を 'gsheet' に変更
 *   2. spreadsheetUrl にスプレッドシートのURLを貼る
 *   3. apiKey にAPIキーを貼る
 */
export const CONFIG = {
  source: 'local',

  gsheet: {
    // ブラウザのアドレスバーのURLをそのまま貼ればOK（IDを切り出す必要はありません）
    // 例: 'https://docs.google.com/spreadsheets/d/xxxxxxxx/edit#gid=0'
    // ※「Googleスプレッドシート形式」のファイルのURLであること（アップロードした
    //   .xlsx のままでは読み取りAPIが使えません → ファイル → Googleスプレッドシートとして保存）
    spreadsheetUrl: '',

    // URLの代わりにIDだけを書いてもOK
    spreadsheetId: '',

    // Google Sheets API キー（設定すると、シート名の自動取得と単語の読み込みに使われます）
    // 「毎週シートを追加するだけ」でホームの一覧に自動で並びます。
    // 作成後は必ず HTTPリファラー制限 と Sheets API のみ の制限をかけてください。
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
