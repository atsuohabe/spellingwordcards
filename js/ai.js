/**
 * Claude API で、写真から英単語を読み取り、小学生向けの日本語訳をつける。
 * API キーはこの端末のブラウザにだけ保存され、Anthropic の API にだけ送られる。
 */
import { CONFIG } from './config.js?v=2026-11-07a';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.2.0/+esm';

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import(SDK_URL).catch((err) => {
      sdkPromise = null;
      throw new Error(`Claude の部品を読み込めませんでした。通信状態を確認してください。\n${err.message}`);
    });
  }
  return sdkPromise;
}

async function client(apiKey) {
  const { default: Anthropic } = await loadSdk();
  // 家庭用の静的サイトなので、ブラウザから直接呼ぶ（キーは利用者自身のもの）
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** 訳のつけ方（今のマスタの書き方に合わせる） */
const STYLE_GUIDE = `日本語訳は、日本の小学4年生が単語カードの裏で見て分かる短い訳にしてください。
- 小学校で習わない・むずかしい漢字には、漢字のすぐ後に全角かっこでふりがなをつける。例: 蛇口（じゃぐち）、誇（ほこ）らしい、準備（じゅんび）する
- やさしい漢字はそのまま。ひらがなの方が自然ならひらがなで書く
- 意味が2つ以上あるときは「・」でつなぐ（多くても3つまで）。例: なみだ・やぶる、記録（きろく）する・レコード
- 動詞は「〜する」「〜える」など辞書の形、形容詞は「〜い」「〜な」で
- 同じ発音でつづりがちがう単語（同音異義語）が同じリストにあるときは、ちがいが分かる訳にする
これまでの訳の例: aloud→声に出して / faucet→蛇口（じゃぐち） / tear→なみだ・やぶる / sore→痛（いた）い / worth→価値（かち）がある / record→記録（きろく）する・レコード`;

const SCAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'プリントの見出し（例: Spelling 4.6 Homophones）。なければ空文字' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string', description: '英単語（印刷どおりのつづり）' },
          ja: { type: 'string', description: '日本語訳' },
        },
        required: ['word', 'ja'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'words'],
  additionalProperties: false,
};

const RETRANSLATE_SCHEMA = {
  type: 'object',
  properties: { ja: { type: 'string' } },
  required: ['ja'],
  additionalProperties: false,
};

async function ask(apiKey, { content, schema, effort }) {
  const anthropic = await client(apiKey);
  let response;
  try {
    response = await anthropic.beta.messages.create({
      model: CONFIG.scan.model,
      max_tokens: 16000,
      // 安全フィルタで断られたときは、サーバー側で別のモデルに自動でやり直してもらう
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    throw new Error(describeApiError(err));
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude がこの内容の処理を断りました。別の写真で試してください。');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('読み取り結果が長すぎて途中で切れました。写真を2回に分けて試してください。');
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Claude の返事を読み取れませんでした。もう一度試してください。');
  }
}

function describeApiError(err) {
  const status = err?.status;
  if (status === 401) return 'Claude の API キーが正しくありません。設定を確認してください。';
  if (status === 403) return 'この API キーでは Claude を使う権限がありません。';
  if (status === 429) return 'Claude が混み合っているか、利用上限に達しました。少し待ってから試してください。';
  if (status === 413) return '写真のサイズが大きすぎます。';
  if (status >= 500) return 'Claude のサーバーが一時的に使えません。少し待ってから試してください。';
  if (!status) return `Claude につながりませんでした。通信状態を確認してください。\n${err?.message || ''}`;
  return `Claude でエラーが起きました (${status})\n${err?.message || ''}`;
}

/**
 * 写真（JPEG の base64）から単語リストを作る。
 * 戻り値: { title, words: [{ word, ja }] }（プリントの並び順）
 */
export async function scanImage(apiKey, { base64, mediaType }) {
  const result = await ask(apiKey, {
    effort: 'medium',
    schema: SCAN_SCHEMA,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      {
        type: 'text',
        text: `これは英語のスペリング練習用プリント（単語カード）の写真です。
カードに書かれている英単語を、すべて読み取ってください。

- 並び順は、プリントの左上から右へ、1行ずつ下へ（左→右、上→下）
- 名前欄・見出し・ページ番号・出版社名・著作権表示などは単語に入れない
- つづりは印刷どおりに。アポストロフィはふつうの ' を使う（例: who's）
- 手書きの書き込みは単語に入れない

${STYLE_GUIDE}`,
      },
    ],
  });
  const words = (result.words || [])
    .map((w) => ({ word: normalizeWord(w.word), ja: String(w.ja || '').trim() }))
    .filter((w) => w.word);
  return { title: String(result.title || '').trim(), words };
}

/** 1語だけ訳をつけ直す（いまの訳とはちがう案を出す） */
export async function retranslate(apiKey, { word, current, others }) {
  const result = await ask(apiKey, {
    effort: 'low',
    schema: RETRANSLATE_SCHEMA,
    content: [{
      type: 'text',
      text: `英単語「${word}」の日本語訳を1つ考えてください。
${current ? `いまの訳「${current}」とは別の言い方にしてください（より分かりやすく、または意味を足すなど）。` : ''}
同じリストにある他の単語: ${others.join(', ') || '（なし）'}

${STYLE_GUIDE}`,
    }],
  });
  return String(result.ja || '').trim();
}

export function normalizeWord(word) {
  return String(word || '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
}
