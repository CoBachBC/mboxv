'use strict';
/* Lector MBOX — utilidades MIME compartidas por la página y el indexador */
/* =====================================================================
   UTILIDADES
   ===================================================================== */
const XUD = new TextDecoder('x-user-defined');   // 1 byte = 1 carácter (bytes altos -> U+F780..U+F7FF)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const fmtNum = n => n.toLocaleString('es-MX');
const sleep = () => new Promise(r => setTimeout(r, 0));

function bin2bytes(s) { const n = s.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = s.charCodeAt(i) & 255; return u; }
function bytes2bin(u) { let s = ''; const C = 0x8000; for (let i = 0; i < u.length; i += C) s += String.fromCharCode.apply(null, u.subarray(i, i + C)); return s; }

function decodeBytes(u, cs) {
  cs = (cs || '').toLowerCase().trim().replace(/^["']|["']$/g, '');
  if (!cs || cs === 'us-ascii' || cs === 'ascii' || cs === 'utf8') cs = 'utf-8';
  if (cs === 'utf-8') { try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { return new TextDecoder('windows-1252').decode(u); } }
  try { return new TextDecoder(cs).decode(u); }
  catch (e) { try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e2) { return new TextDecoder('windows-1252').decode(u); } }
}
function decode8bit(s) { return /[-]/.test(s) ? decodeBytes(bin2bytes(s), 'utf-8') : s; }

function b64bytes(s) {
  s = s.replace(/[^A-Za-z0-9+/]/g, '');
  if (s.length % 4 === 1) s = s.slice(0, -1);
  while (s.length % 4) s += '=';
  try { return bin2bytes(atob(s)); } catch (e) { return new Uint8Array(0); }
}
function qpDecode(s, underscore) {
  s = s.replace(/=\r?\n/g, '');
  const out = new Uint8Array(s.length); let j = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 61 && i + 2 < s.length + 0 && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out[j++] = parseInt(s.substr(i + 1, 2), 16); i += 2; }
    else if (underscore && c === 95) out[j++] = 32;
    else out[j++] = c & 255;
  }
  return out.subarray(0, j);
}
function pctBytes(s) { const a = []; for (let i = 0; i < s.length; i++) { if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { a.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else a.push(s.charCodeAt(i) & 255); } return a; }

/* RFC 2047: =?charset?B|Q?texto?= */
function decodeWords(s) {
  if (!s) return '';
  s = decode8bit(s);
  s = s.replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, '$1');
  return s.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (m, cs, enc, txt) => {
    try { const b = enc.toUpperCase() === 'B' ? b64bytes(txt) : qpDecode(txt, true); return decodeBytes(b, cs.split('*')[0]); } catch (e) { return m; }
  });
}

/* =====================================================================
   PARSER MIME
   ===================================================================== */
function splitHB(s) { const m = /\r?\n\r?\n/.exec(s); return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s, '']; }

function parseHeaders(h) {
  const list = [];
  for (const ln of h.split(/\r?\n/)) {
    if (/^[ \t]/.test(ln) && list.length) list[list.length - 1].v += ' ' + ln.trim();
    else { const k = ln.indexOf(':'); if (k > 0) list.push({ n: ln.slice(0, k).trim(), v: ln.slice(k + 1).trim() }); }
  }
  const map = {};
  for (const x of list) { const n = x.n.toLowerCase(); (map[n] || (map[n] = [])).push(x.v); }
  return { list, map, get(n) { const a = map[n]; return a ? a[0] : ''; }, all(n) { return map[n] || []; } };
}

function parseParams(v) {
  const parts = []; let cur = '', q = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '"') { q = !q; cur += c; }
    else if (c === '\\' && q) { cur += c + (v[i + 1] || ''); i++; }
    else if (c === ';' && !q) { parts.push(cur); cur = ''; }
    else cur += c;
  }
  parts.push(cur);
  const value = (parts.shift() || '').trim().toLowerCase();
  const params = {}, cont = {};
  for (const p of parts) {
    const k = p.indexOf('='); if (k < 0) continue;
    const key = p.slice(0, k).trim().toLowerCase();
    let val = p.slice(k + 1).trim();
    if (val.startsWith('"')) val = val.slice(1, val.endsWith('"') && val.length > 1 ? -1 : undefined).replace(/\\(.)/g, '$1');
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
    if (m && (m[2] !== undefined || m[3])) (cont[m[1]] || (cont[m[1]] = [])).push({ i: m[2] === undefined ? 0 : +m[2], enc: !!m[3], val });
    else params[key] = val;
  }
  for (const [base, arr] of Object.entries(cont)) {   // RFC 2231
    arr.sort((a, b) => a.i - b.i);
    let cs = 'utf-8'; const bytes = [];
    arr.forEach((x, idx) => {
      let val = x.val;
      if (x.enc) {
        if (idx === 0) { const mm = /^([^']*)'[^']*'(.*)$/.exec(val); if (mm) { cs = mm[1] || 'utf-8'; val = mm[2]; } }
        for (const b of pctBytes(val)) bytes.push(b);
      } else for (let i = 0; i < val.length; i++) bytes.push(val.charCodeAt(i) & 255);
    });
    try { params[base] = decodeBytes(new Uint8Array(bytes), cs); } catch (e) {}
  }
  return { value, params };
}

function splitMultipart(body, boundary) {
  const e = boundary.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  const re = new RegExp('(^|\\r?\\n)--' + e + '(--)?[ \\t]*(\\r?\\n|$)', 'g');
  const parts = []; let m, last = -1;
  while ((m = re.exec(body))) {
    if (last >= 0) parts.push(body.slice(last, Math.max(last, m.index)));
    if (m[2]) { last = -1; break; }
    last = m.index + m[0].length;
    re.lastIndex = last - (m[3] ? m[3].length : 0);
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
  }
  if (last >= 0 && last < body.length) parts.push(body.slice(last));
  return parts;
}

function parseEntity(s, defType, depth) {
  depth = depth || 0;
  const [h, b] = splitHB(s);
  const H = parseHeaders(h);
  const ctv = H.get('content-type');
  const ct = ctv ? parseParams(ctv) : { value: defType || 'text/plain', params: {} };
  if (!ct.value || !ct.value.includes('/')) ct.value = defType || 'text/plain';
  const cdv = H.get('content-disposition');
  const cd = cdv ? parseParams(cdv) : { value: '', params: {} };
  const n = {
    H, type: ct.value, ctp: ct.params, disp: cd.value, dp: cd.params,
    cte: (H.get('content-transfer-encoding') || '').toLowerCase().trim(),
    cid: decode8bit(H.get('content-id') || '').replace(/^\s*<|>\s*$/g, '').trim(),
    body: b, children: null
  };
  n.filename = decodeWords(n.dp.filename || n.ctp.name || '').replace(/[\\/]/g, '_').trim();
  if (n.type.startsWith('multipart/') && n.ctp.boundary && depth < 40) {
    const dt = n.type === 'multipart/digest' ? 'message/rfc822' : 'text/plain';
    n.children = splitMultipart(b, n.ctp.boundary).map(p => parseEntity(p, dt, depth + 1));
    n.body = '';
  }
  return n;
}

function partBytes(n) {
  if (n.cte === 'base64') return b64bytes(n.body);
  if (n.cte === 'quoted-printable') return qpDecode(n.body);
  return bin2bytes(n.body);
}
function partText(n, max) {
  let body = n.body;
  if (max && body.length > max * 2) body = body.slice(0, max * 2);
  const nn = body === n.body ? n : Object.assign({}, n, { body });
  return decodeBytes(partBytes(nn), n.ctp.charset || 'utf-8');
}
function estSize(n) { return n.cte === 'base64' ? Math.floor(n.body.replace(/\s/g, '').length * 3 / 4) : n.body.length; }

/* Clasifica el árbol: cuerpo(s) visibles, adjuntos e imágenes incrustadas (cid) */
function walkTree(root) {
  const ctx = { root, bodies: [], atts: [], cids: {}, altText: null };
  (function walk(n) {
    if (n.children) {
      if (n.type === 'multipart/alternative' && n.children.length) {
        const k = n.children; let pick = null;
        for (let i = k.length - 1; i >= 0; i--) if (k[i].children || k[i].type === 'text/html') { pick = k[i]; break; }
        if (!pick) pick = k.find(x => x.type === 'text/plain') || k[k.length - 1];
        for (const x of k) { if (x === pick) walk(x); else if (x.type === 'text/plain' && !ctx.altText) ctx.altText = x; }
        return;
      }
      for (const x of n.children) walk(x);
      return;
    }
    if (n.type === 'message/rfc822' && n !== root) { ctx.atts.push(n); return; }
    const isText = n.type === 'text/plain' || n.type === 'text/html';
    if (isText && n.disp !== 'attachment' && !(n.filename && n.disp !== 'inline')) { ctx.bodies.push(n); return; }
    if (n.cid) ctx.cids[n.cid.toLowerCase()] = n;
    if (!n.body && !n.filename) return;
    ctx.atts.push(n);
  })(root);
  return ctx;
}

/* =====================================================================
   TEXTO Y HTML
   ===================================================================== */
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', deg: '°', bull: '•', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', euro: '€' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch (_) { return m; } }
    const v = ENT[e.toLowerCase()]; return v === undefined ? m : v;
  });
}
function html2text(h) {
  return decodeEntities(h.replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|blockquote)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
function linkify(escaped) {
  return escaped.replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"&]|https?:\/\/[^\s<]+(?:&amp;[^\s<]+)+)/g, '<a href="$1">$1</a>');
}
function text2html(t) {
  const lines = esc(t).split(/\r?\n/).map(l => /^(&gt;\s?)+/.test(l) ? '<span class="q">' + l + '</span>' : l);
  return '<pre class="plain">' + linkify(lines.join('\n')) + '</pre>';
}
const FRAME_CSS = 'html{background:#fff}body{font:14px/1.55 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:#202124;margin:18px 20px;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre.plain{white-space:pre-wrap;font:14px/1.55 "Segoe UI",system-ui,Arial,sans-serif;margin:0}span.q{color:#7a6f69}a{color:#1a56b8}blockquote{border-left:3px solid #ddd;margin:8px 0;padding-left:12px;color:#555}table{max-width:100%}hr.sep{border:0;border-top:1px dashed #ccc;margin:22px 0}';
function frameDoc(inner, allowRemote, extraCss) {
  const r = allowRemote ? ' https: http:' : '';
  const csp = "default-src 'none'; img-src data:" + r + "; style-src 'unsafe-inline'" + r + "; font-src data:" + r + "; media-src data:";
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><base target="_blank"><style>' + FRAME_CSS + (extraCss || '') + '</style></head><body>' + inner + '</body></html>';
}
function hasRemote(html) { return /<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:|background\s*=\s*["']?\s*https?:|<link[^>]+href\s*=\s*["']?\s*https?:/i.test(html); }
function toDataURL(n) {
  const b64 = n.cte === 'base64' ? n.body.replace(/[^A-Za-z0-9+/=]/g, '') : btoa(bytes2bin(partBytes(n)));
  return 'data:' + (n.type || 'application/octet-stream') + ';base64,' + b64;
}

function buildBody(root) {
  const ctx = walkTree(root);
  const parts = [];
  for (const b of ctx.bodies) { const t = partText(b); parts.push(b.type === 'text/html' ? t : text2html(t)); }
  let html = parts.length ? parts.join('<hr class="sep">') : '<p style="color:#888">(Mensaje sin cuerpo de texto)</p>';
  const used = new Set();
  html = html.replace(/(["'(=\s])cid:([^"')\s>]+)/gi, (m, p, id) => {
    let k = id; try { k = decodeURIComponent(id); } catch (e) {}
    const n = ctx.cids[k.toLowerCase()];
    if (n) { used.add(n); return p + toDataURL(n); }
    return m;
  });
  return { html, atts: ctx.atts.filter(n => !used.has(n)), remote: hasRemote(html), ctx };
}

/* =====================================================================
   DIRECCIONES Y FECHAS
   ===================================================================== */
function parseAddrs(s) {
  s = decodeWords(s || '');
  const out = []; let cur = '', q = false, a = 0;
  for (const c of s) {
    if (c === '"') q = !q;
    if (!q) { if (c === '<') a++; if (c === '>') a--; if ((c === ',' || c === ';') && a <= 0) { out.push(cur); cur = ''; continue; } }
    cur += c;
  }
  out.push(cur);
  return out.map(x => {
    x = x.trim().replace(/^[^:<"]*:\s*/, m => /@/.test(m) ? m : '');
    const m = /^(.*)<([^>]*)>\s*$/.exec(x);
    if (m) return { name: m[1].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').trim(), addr: m[2].trim() };
    const c = /\(([^)]*)\)/.exec(x);
    return { name: c ? c[1].trim() : '', addr: x.replace(/\([^)]*\)/g, '').trim() };
  }).filter(x => x.addr || x.name);
}
const addrTxt = a => a.name ? a.name + ' <' + a.addr + '>' : a.addr;
function parseDate(s, fromLine) {
  let t = Date.parse((s || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim());
  if (isNaN(t) && fromLine) { const m = /^From \S+\s+(.*)$/.exec(fromLine); if (m) t = Date.parse(m[1]); }
  return isNaN(t) ? 0 : t;
}
const DF_FULL = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeStyle: 'medium' });
const DF_SHORT = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DF_DM = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
const DF_HM = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
const DF_ROW = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function listDate(t) {
  if (!t) return '—';
  const d = new Date(t), n = new Date();
  if (d.toDateString() === n.toDateString()) return DF_HM.format(d);
  if (d.getFullYear() === n.getFullYear()) return DF_DM.format(d);
  return DF_SHORT.format(d);
}
function isoLocal(t) { if (!t) return ''; const d = new Date(t), p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

/* =====================================================================
   TIPOS DE ARCHIVO
   ===================================================================== */
const EXT_KIND = {
  pdf: 'pdf', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', bmp: 'img', svg: 'img', ico: 'img', avif: 'img',
  txt: 'text', log: 'text', md: 'text', json: 'text', xml: 'text', ini: 'text', cfg: 'text', conf: 'text', sql: 'text', js: 'text', css: 'text', py: 'text', ps1: 'text', bat: 'text', sh: 'text', yml: 'text', yaml: 'text', ics: 'text', vcf: 'text', vcs: 'text', srt: 'text', vtt: 'text', tsv: 'csv', csv: 'csv',
  htm: 'html', html: 'html', eml: 'eml', docx: 'docx', docm: 'docx', dotx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', pptx: 'pptx', ppsx: 'pptx', pptm: 'pptx', odt: 'odt', ods: 'ods', odp: 'odp', rtf: 'rtf', zip: 'zip',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', opus: 'audio', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video'
};
const BADGES = {
  pdf: ['PDF', '#c62828'], img: ['IMG', '#7b3fa6'], doc: ['DOC', '#1f5fbf'], docx: ['DOC', '#1f5fbf'], odt: ['ODT', '#1f5fbf'], rtf: ['RTF', '#1f5fbf'],
  xlsx: ['XLS', '#1d7a43'], ods: ['ODS', '#1d7a43'], csv: ['CSV', '#1d7a43'], xls: ['XLS', '#1d7a43'], pptx: ['PPT', '#d4561c'], odp: ['ODP', '#d4561c'], ppt: ['PPT', '#d4561c'],
  zip: ['ZIP', '#6b625c'], eml: ['EML', '#b8860b'], text: ['TXT', '#5a6b7a'], html: ['HTML', '#a33d6a'], audio: ['AUD', '#2b7a8c'], video: ['VID', '#2b7a8c'], other: ['', '#8a817b']
};
function extOf(name) { const m = /\.([a-z0-9]{1,6})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function kindOf(n) {
  const name = attName(n), ext = extOf(name), t = n.type || '';
  if (t === 'message/rfc822') return 'eml';
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (t === 'application/pdf') return 'pdf';
  if (/^image\//.test(t)) return 'img';
  if (/^audio\//.test(t)) return 'audio';
  if (/^video\//.test(t)) return 'video';
  if (t === 'text/html') return 'html';
  if (t === 'text/csv') return 'csv';
  if (/^text\//.test(t) || /json|xml|calendar/.test(t)) return 'text';
  if (/wordprocessingml/.test(t)) return 'docx';
  if (/spreadsheetml/.test(t)) return 'xlsx';
  if (/presentationml/.test(t)) return 'pptx';
  if (/zip/.test(t)) return 'zip';
  if (ext === 'doc') return 'doc'; if (ext === 'xls') return 'xls'; if (ext === 'ppt') return 'ppt';
  return 'other';
}
function attName(n) {
  if (n.filename) return n.filename;
  if (n.type === 'message/rfc822') { try { const s = decodeWords(parseHeaders(splitHB(n.body)[0]).get('subject')); return (s || 'mensaje').slice(0, 80) + '.eml'; } catch (e) { return 'mensaje.eml'; } }
  const sub = (n.type || '').split('/')[1] || 'bin';
  return 'adjunto.' + sub.replace(/[^a-z0-9]/gi, '').slice(0, 5);
}
function badgeHTML(kind, ext) {
  const b = BADGES[kind] || BADGES.other;
  const label = b[0] || (ext || 'ARCH').toUpperCase().slice(0, 4);
  return '<span class="badge" style="background:' + b[1] + '">' + esc(label) + '</span>';
}
/* =====================================================================
   INDEXACIÓN (compartido con el Web Worker)
   ===================================================================== */
function isStartLine(s, idx) {   // idx = posición de la "F" de "From "
  if (idx === 0) return true;
  if (s[idx - 1] !== '\n') return false;
  if (idx >= 2 && (s[idx - 2] === '\n' || (s[idx - 2] === '\r' && idx >= 3 && s[idx - 3] === '\n'))) return true;
  let e = s.indexOf('\n', idx); if (e < 0) e = Math.min(s.length, idx + 300);
  return /^From \S+\s+.*\d{1,2}:\d{2}/.test(s.slice(idx, Math.min(e, idx + 300)));
}
/* Extrae el registro compacto de un mensaje: metadatos para la lista/búsqueda y texto normalizado del cuerpo */
function extractRecord(raw, start, end, cap) {
  let fromLine = '', skip = 0;
  if (raw.startsWith('From ')) { const k = raw.indexOf('\n'); fromLine = raw.slice(0, k < 0 ? raw.length : k).replace(/\r$/, ''); skip = k < 0 ? raw.length : k + 1; }
  const body = raw.slice(skip);
  let root;
  try { root = parseEntity(body); } catch (e) { root = { H: parseHeaders(''), type: 'text/plain', ctp: {}, body: body, children: null }; }
  const H = root.H;
  const from = parseAddrs(H.get('from'))[0] || parseAddrs(H.get('sender'))[0] || { name: '', addr: '' };
  const rcpt = [].concat(...H.all('to').map(parseAddrs), ...H.all('cc').map(parseAddrs), ...H.all('bcc').map(parseAddrs));
  const subj = decodeWords(H.get('subject')).replace(/\s+/g, ' ').trim();
  const labels = decodeWords(H.get('x-gmail-labels')).split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
  let text = '', atts = [];
  try {
    const ctx = walkTree(root);
    const tparts = [];
    if (ctx.altText && !ctx.bodies.some(b => b.type === 'text/plain')) tparts.push(partText(ctx.altText, cap));
    for (const b of ctx.bodies) { const t = partText(b, cap * 3); tparts.push(b.type === 'text/html' ? html2text(t) : t); }
    text = tparts.join('\n').replace(/\s+/g, ' ').trim();
    atts = ctx.atts.filter(n => !(n.cid && n.disp !== 'attachment' && /^image\//.test(n.type) && !n.filename)).map(n => ({ name: attName(n), kind: kindOf(n) }));
  } catch (e) { text = ''; }
  return {
    r: {
      s: start, e: end, d: parseDate(H.get('date'), fromLine),
      fn: from.name, fa: from.addr, su: subj, sn: text.slice(0, 140),
      na: atts.length, ak: atts.length ? ' ' + [...new Set(atts.map(a => a.kind))].join(' ') + ' ' : '',
      an: atts.map(a => a.name).join(' · ').slice(0, 300), lb: labels,
      nF: norm(from.name + ' ' + from.addr), nT: norm(rcpt.map(addrTxt).join(' ')).slice(0, 800),
      nS: norm(subj), nA: norm(atts.map(a => a.name).join(' | ')).slice(0, 800), nL: norm(labels.join('|'))
    },
    b: norm(text).slice(0, cap)
  };
}
