/* Lector MBOX — indexador en segundo plano (Web Worker)
   Lee el archivo por partes, extrae los metadatos de cada mensaje y los guarda en IndexedDB.
   El índice queda en el disco: la siguiente vez que se abre el mismo archivo no se vuelve a indexar,
   y si la indexación se interrumpe, continúa desde donde se quedó. */
'use strict';
importScripts('mime.js');

const BATCH = 2000;                 // mensajes por lote guardado
const CH = 8 * 1024 * 1024;         // bytes leídos por vuelta
const DBNAME = 'lectorMboxV2';
const running = new Map();          // key -> { stop }
let scanQid = 0;
let queue = Promise.resolve();      // las indexaciones se hacen una por una

let dbp = null;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DBNAME, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('files', { keyPath: 'key' }); d.createObjectStore('meta'); d.createObjectStore('body'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const P = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const T = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transacción cancelada')); });
const range = key => IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
const post = (m, tr) => self.postMessage(m, tr || []);
function errMsg(e) {
  if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) return 'No hay espacio suficiente en el disco para guardar el índice. Libera espacio y vuelve a abrir el archivo para continuar.';
  if (e && e.name === 'NotReadableError') return 'No se pudo leer el archivo. ¿Se movió, se borró o está en una unidad desconectada?';
  return (e && e.message) || String(e);
}

self.onmessage = e => {
  const d = e.data;
  if (d.cmd === 'open') openFile(d).catch(err => post({ type: 'error', key: d.key, msg: errMsg(err) }));
  else if (d.cmd === 'resume') enqueue(d.key, d.file);
  else if (d.cmd === 'stop') { const r = running.get(d.key); if (r) r.stop = true; }
  else if (d.cmd === 'scan') { scanQid = d.qid; scan(d).catch(err => post({ type: 'error', key: '', msg: errMsg(err) })); }
  else if (d.cmd === 'list') list();
  else if (d.cmd === 'delete') del(d.key).then(list).catch(err => post({ type: 'error', key: d.key, msg: errMsg(err) }));
};

async function getRec(key) { const D = await db(); return P(D.transaction('files').objectStore('files').get(key)); }
async function putRec(rec) { const D = await db(); const t = D.transaction('files', 'readwrite'); t.objectStore('files').put(rec); await T(t); }

async function openFile(d) {
  const D = await db();
  let rec = await getRec(d.key);
  if (!rec) rec = { key: d.key, name: d.name, size: d.size, lastModified: d.lastModified, count: 0, batches: 0, offset: 0, complete: false, created: Date.now(), updated: Date.now(), cap: d.cap };
  if (d.handle) rec.handle = d.handle;
  try { await putRec(rec); } catch (e) { if (d.handle) { delete rec.handle; await putRec(rec); } else throw e; }
  // 1) enviar el índice ya guardado
  let n = 0;
  await new Promise((res, rej) => {
    const c = D.transaction('meta').objectStore('meta').openCursor(range(d.key));
    c.onsuccess = () => { const cur = c.result; if (cur) { post({ type: 'batch', key: d.key, recs: cur.value }); n += cur.value.length; cur.continue(); } else res(); };
    c.onerror = () => rej(c.error);
  });
  post({ type: 'loaded', key: d.key, count: n, complete: rec.complete, bytes: rec.offset, total: rec.size });
  // 2) indexar lo que falte
  if (!rec.complete) enqueue(d.key, d.file);
  list();
}

function enqueue(key, file) {
  if (running.has(key)) return;
  running.set(key, { stop: false, queued: true });
  post({ type: 'queued', key });
  queue = queue.then(() => indexFile(key, file)).catch(err => { running.delete(key); post({ type: 'error', key, msg: errMsg(err) }); });
}

async function indexFile(key, file) {
  const D = await db();
  const rec = await getRec(key);
  const ctl = running.get(key) || { stop: false };
  running.set(key, ctl);
  if (!rec || rec.complete) { running.delete(key); post({ type: 'done', key, count: rec ? rec.count : 0 }); return; }
  if (ctl.stop) { running.delete(key); post({ type: 'stopped', key, bytes: rec.offset, total: rec.size }); return; }
  const cap = rec.cap || (rec.size < 1.5e9 ? 30000 : 3000);
  let off = rec.offset, carry = '', carryOff = off, first = off === 0, single = false;
  let recs = [], bodies = [], bodyChars = 0, ord = rec.count, lastEnd = off;
  const t0 = Date.now(), off0 = off; let lastPost = 0;

  async function flush(final) {
    const t = D.transaction(['meta', 'body', 'files'], 'readwrite');
    if (recs.length) { t.objectStore('meta').put(recs, [key, rec.batches]); t.objectStore('body').put(bodies, [key, rec.batches]); }
    const nb = rec.batches + (recs.length ? 1 : 0);
    const upd = Object.assign({}, rec, { batches: nb, count: ord, offset: lastEnd, updated: Date.now(), complete: !!final });
    t.objectStore('files').put(upd);
    await T(t);
    Object.assign(rec, upd);
    if (recs.length) post({ type: 'batch', key, recs });
    recs = []; bodies = []; bodyChars = 0;
  }
  function add(raw, a, b) {
    const x = extractRecord(raw, a, b, cap);
    x.r.o = ord++;
    recs.push(x.r); bodies.push(x.b); bodyChars += x.b.length; lastEnd = b;
  }

  post({ type: 'progress', key, bytes: off, total: file.size, count: ord, rate: 0 });
  while (off < file.size || carry) {
    if (ctl.stop) { await flush(false); running.delete(key); post({ type: 'stopped', key, bytes: rec.offset, total: rec.size }); return; }
    let chunk = '';
    if (off < file.size) { const buf = await file.slice(off, off + CH).arrayBuffer(); chunk = XUD.decode(buf); off += buf.byteLength; }
    const last = off >= file.size;
    let s = carry + chunk;
    if (first) {
      first = false;
      let k = 0; while (k < s.length && (s[k] === '\r' || s[k] === '\n')) k++;
      if (!s.startsWith('From ', k)) single = true;        // archivo .eml (un solo mensaje)
      else if (k) { s = s.slice(k); carryOff += k; }
    }
    if (single) {
      if (!last) { carry = s; continue; }
      add(s, carryOff, carryOff + s.length); carry = ''; break;
    }
    const limit = last ? s.length : Math.max(0, s.length - 4096);
    const starts = [0];
    const re = /\nFrom /g; let m;
    while ((m = re.exec(s)) && m.index + 1 < limit) { if (isStartLine(s, m.index + 1)) starts.push(m.index + 1); }
    const usable = last ? starts.length : starts.length - 1;
    for (let i = 0; i < usable; i++) {
      const a = starts[i], b = i + 1 < starts.length ? starts[i + 1] : s.length;
      add(s.slice(a, b), carryOff + a, carryOff + b);
    }
    if (last) { carry = ''; break; }
    const ls = starts[starts.length - 1];
    carry = s.slice(ls); carryOff += ls;
    if (recs.length >= BATCH || bodyChars > 8e6) await flush(false);
    const now = Date.now();
    if (now - lastPost > 400) { lastPost = now; post({ type: 'progress', key, bytes: off, total: file.size, count: ord, rate: (off - off0) / Math.max(0.5, (now - t0) / 1000) }); }
  }
  await flush(true);
  running.delete(key);
  post({ type: 'done', key, count: ord });
  list();
}

/* Búsqueda en el texto de los mensajes: devuelve, por archivo, una máscara de bits (un bit por término) */
async function scan(d) {
  const D = await db();
  const terms = d.terms, n = d.keys.length;
  for (let ki = 0; ki < n; ki++) {
    const key = d.keys[ki];
    const rec = await getRec(key);
    const total = rec ? rec.batches : 0;
    const mask = new Uint16Array(rec ? rec.count : 0);
    let ord = 0;
    for (let bi = 0; bi < total; bi++) {
      if (scanQid !== d.qid) return;
      const arr = await P(D.transaction('body').objectStore('body').get([key, bi]));
      if (!arr) continue;
      for (let j = 0; j < arr.length && ord + j < mask.length; j++) {
        const s = arr[j]; let bits = 0;
        for (let k = 0; k < terms.length; k++) if (s.includes(terms[k])) bits |= 1 << k;
        mask[ord + j] = bits;
      }
      ord += arr.length;
      if (bi % 4 === 0) post({ type: 'scanProgress', qid: d.qid, pct: (ki + (bi + 1) / total) / n });
    }
    if (scanQid !== d.qid) return;
    post({ type: 'scan', qid: d.qid, key, mask, last: ki === n - 1 }, [mask.buffer]);
  }
  if (!n) post({ type: 'scan', qid: d.qid, key: null, mask: null, last: true });
}

async function list() {
  try {
    const D = await db();
    const files = await P(D.transaction('files').objectStore('files').getAll());
    let usage = null; try { const u = await navigator.storage.estimate(); usage = { usage: u.usage, quota: u.quota }; } catch (e) {}
    post({ type: 'list', usage, files: files.map(f => ({ key: f.key, name: f.name, size: f.size, lastModified: f.lastModified, count: f.count, complete: f.complete, offset: f.offset, updated: f.updated, handle: f.handle || null, running: running.has(f.key) })) });
  } catch (e) { post({ type: 'error', key: '', msg: errMsg(e) }); }
}

async function del(key) {
  if (running.has(key)) throw new Error('Detén la indexación antes de borrar el índice.');
  const D = await db();
  const t = D.transaction(['files', 'meta', 'body'], 'readwrite');
  t.objectStore('files').delete(key); t.objectStore('meta').delete(range(key)); t.objectStore('body').delete(range(key));
  await T(t);
}
