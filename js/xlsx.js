/**
 * マスタの .xlsx に、新しいシートを1枚つけ足す。
 * 既存のシートには一切さわらず、xlsx（中身は zip）の部品を足すだけにしている。
 * 作るシートの形は今のマスタと同じ:  No. | Word | Translation
 */
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const WORKSHEET_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

let jszipPromise = null;

/** JSZip は写真取り込みを使うときだけ読み込む */
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSZIP_URL;
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => {
        jszipPromise = null;
        reject(new Error('Excel を扱う部品（JSZip）を読み込めませんでした。通信状態を確認してください。'));
      };
      document.head.appendChild(script);
    });
  }
  return jszipPromise;
}

const parse = (text) => new DOMParser().parseFromString(text, 'application/xml');
const serialize = (doc) => new XMLSerializer().serializeToString(doc);

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** シートの並び順のまま、シート名の一覧を返す */
export async function listSheetNames(xlsxBytes) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(xlsxBytes);
  const workbook = parse(await zip.file('xl/workbook.xml').async('string'));
  return [...workbook.getElementsByTagNameNS(NS_MAIN, 'sheet')].map((s) => s.getAttribute('name'));
}

function cell(ref, value, style) {
  if (typeof value === 'number') return `<c r="${ref}"${style} t="n"><v>${value}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** 既存シートと同じ見た目（太字などのスタイル番号）を引き継ぐ */
async function findCellStyle(zip, workbook, rels) {
  const first = workbook.getElementsByTagNameNS(NS_MAIN, 'sheet')[0];
  if (!first) return '';
  const rel = [...rels.getElementsByTagNameNS(NS_PKG_REL, 'Relationship')]
    .find((r) => r.getAttribute('Id') === first.getAttributeNS(NS_REL, 'id'));
  if (!rel) return '';
  const target = rel.getAttribute('Target').replace(/^\//, '');
  const path = target.startsWith('xl/') ? target : `xl/${target}`;
  const file = zip.file(path);
  if (!file) return '';
  const match = (await file.async('string')).match(/<c r="B2" s="(\d+)"/);
  return match ? ` s="${match[1]}"` : '';
}

function buildSheetXml(cards, style) {
  const rows = [
    `<row r="1">${cell('A1', 'No.', style)}${cell('B1', 'Word', style)}${cell('C1', 'Translation', style)}</row>`,
    ...cards.map((c, i) => {
      const r = i + 2;
      return `<row r="${r}">${cell(`A${r}`, i + 1, style)}${cell(`B${r}`, c.word, style)}` +
        `${c.ja ? cell(`C${r}`, c.ja, style) : ''}</row>`;
    }),
  ];
  const last = cards.length + 1;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:C${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr baseColWidth="10" defaultRowHeight="16"/>' +
    '<cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>' +
    '<col min="3" max="3" width="30" customWidth="1"/></cols>' +
    `<sheetData>${rows.join('')}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>';
}

/**
 * xlsx の末尾にシートを足して、新しい xlsx（Uint8Array）を返す。
 * cards: [{ word, ja }]（この順番で No. 1, 2, 3 … と番号をふる）
 */
export async function appendSheet(xlsxBytes, sheetName, cards) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(xlsxBytes);

  const workbookPath = 'xl/workbook.xml';
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const typesPath = '[Content_Types].xml';
  const workbook = parse(await zip.file(workbookPath).async('string'));
  const rels = parse(await zip.file(relsPath).async('string'));
  const types = parse(await zip.file(typesPath).async('string'));

  const sheets = workbook.getElementsByTagNameNS(NS_MAIN, 'sheets')[0];
  const existing = [...sheets.getElementsByTagNameNS(NS_MAIN, 'sheet')];
  if (existing.some((s) => s.getAttribute('name').toLowerCase() === sheetName.toLowerCase())) {
    throw new Error(`「${sheetName}」という名前のシートは、もうマスタにあります。`);
  }

  // 空いているファイル名・ID を決める
  let n = 1;
  while (zip.file(`xl/worksheets/sheet${n}.xml`)) n++;
  const sheetFile = `xl/worksheets/sheet${n}.xml`;
  const relIds = new Set([...rels.getElementsByTagNameNS(NS_PKG_REL, 'Relationship')].map((r) => r.getAttribute('Id')));
  let r = relIds.size + 1;
  while (relIds.has(`rId${r}`)) r++;
  const relId = `rId${r}`;
  const sheetId = Math.max(0, ...existing.map((s) => Number(s.getAttribute('sheetId')) || 0)) + 1;

  const style = await findCellStyle(zip, workbook, rels);
  zip.file(sheetFile, buildSheetXml(cards, style));

  // workbook.xml にシートを登録（いちばん後ろ）
  const sheetEl = workbook.createElementNS(NS_MAIN, 'sheet');
  sheetEl.setAttribute('name', sheetName);
  sheetEl.setAttribute('sheetId', String(sheetId));
  sheetEl.setAttribute('state', 'visible');
  sheetEl.setAttributeNS(NS_REL, 'r:id', relId);
  sheets.appendChild(sheetEl);
  // 開いたときに新しいシートが選ばれているようにする
  const view = workbook.getElementsByTagNameNS(NS_MAIN, 'workbookView')[0];
  if (view) view.setAttribute('activeTab', String(existing.length));
  zip.file(workbookPath, serialize(workbook));

  // 前に選ばれていたシートの「選択中」を外す（複数選択のまま開かないように）
  for (const path of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path) || path === sheetFile) continue;
    const xml = await zip.file(path).async('string');
    if (xml.includes('tabSelected="1"')) zip.file(path, xml.replace(/ tabSelected="1"/g, ''));
  }

  const relEl = rels.createElementNS(NS_PKG_REL, 'Relationship');
  relEl.setAttribute('Id', relId);
  relEl.setAttribute('Type', WORKSHEET_REL);
  relEl.setAttribute('Target', `/${sheetFile}`);
  rels.documentElement.appendChild(relEl);
  zip.file(relsPath, serialize(rels));

  const override = types.createElementNS(NS_TYPES, 'Override');
  override.setAttribute('PartName', `/${sheetFile}`);
  override.setAttribute('ContentType', WORKSHEET_TYPE);
  types.documentElement.appendChild(override);
  zip.file(typesPath, serialize(types));

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
