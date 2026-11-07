/**
 * GitHub への保存（マスタの xlsx と data/*.json を、1つのコミットでまとめて更新する）。
 * トークンは「Fine-grained personal access token」で、このリポジトリの Contents: Read and write だけを許可したもの。
 */
const API = 'https://api.github.com';

export class GitHubError extends Error {}

function describe(status, body) {
  if (status === 401) return 'GitHub のトークンが正しくないか、期限が切れています。';
  if (status === 403) return 'GitHub のトークンに書き込みの権限がありません（Contents: Read and write が必要です）。';
  if (status === 404) return 'リポジトリかファイルが見つかりません。トークンの対象リポジトリと config.js の設定を確認してください。';
  return `GitHub への保存に失敗しました (${status}) ${body?.message || ''}`;
}

export function createClient({ token, owner, repo, branch }) {
  const base = `${API}/repos/${owner}/${repo}`;

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new GitHubError(describe(res.status, data));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** 中身を Uint8Array で取り出す（Git の blob から読むので 1MB を超えても大丈夫） */
  async function readBlob(sha) {
    const blob = await call('GET', `/git/blobs/${sha}`);
    return base64ToBytes(blob.content);
  }

  return {
    /** ブランチの最新コミットと、そこにあるファイルの一覧（パス → blob sha） */
    async snapshot() {
      const ref = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      const commitSha = ref.object.sha;
      const commit = await call('GET', `/git/commits/${commitSha}`);
      const tree = await call('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
      const files = new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
      return { commitSha, treeSha: commit.tree.sha, files };
    },

    async readFile(snapshot, path) {
      const sha = snapshot.files.get(path);
      if (!sha) return null;
      return readBlob(sha);
    },

    /**
     * 複数ファイルを1コミットで書き込む。
     * files: [{ path, bytes?: Uint8Array, text?: string }]
     * 他の更新とぶつかった（先に誰かがコミットした）ときは GitHubError(status 422) になる。
     */
    async commit(snapshot, files, message) {
      const tree = [];
      for (const f of files) {
        const blob = f.bytes
          ? await call('POST', '/git/blobs', { content: bytesToBase64(f.bytes), encoding: 'base64' })
          : await call('POST', '/git/blobs', { content: f.text, encoding: 'utf-8' });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await call('POST', '/git/trees', { base_tree: snapshot.treeSha, tree });
      const commit = await call('POST', '/git/commits', {
        message, tree: newTree.sha, parents: [snapshot.commitSha],
      });
      await call('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
      return commit;
    },
  };
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
