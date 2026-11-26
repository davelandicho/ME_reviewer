/* Reads a reviewer PDF laid out like "MD Refresher Set 2":
 *
 *   1. Question text...
 *      A. choice          C. choice
 *      B. choice          D. choice
 *   Answer: B. choice | Keyword: memory trick
 *
 * Choices can be in 1 or 2 columns. The answer letter is taken from the "Answer:" line.
 * Exposes window.ReviewerPdf.parseFile(file) -> { questions, warnings }.
 */
(function (global) {
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let loading = null;

  function loadPdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS_URL + 'pdf.min.js';
        s.onload = () => {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_URL + 'pdf.worker.min.js';
          resolve(global.pdfjsLib);
        };
        s.onerror = () => { loading = null; reject(new Error('Could not load the PDF reader. Check your internet connection.')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  // -> [{ width, items: [{ str, x, y, w }] }]
  async function readPages(data, pdfjsLib) {
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { width } = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      pages.push({
        width,
        items: tc.items
          .filter(i => i.str && i.str.trim())
          .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))
      });
    }
    return pages;
  }

  // Joins text pieces on one line, adding a space only where there is a visible gap
  function joinItems(items) {
    let out = '';
    let prev = null;
    for (const it of items) {
      if (prev && it.x - (prev.x + prev.w) > 1.5 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
      out += it.str;
      prev = it;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function toLines(pages) {
    const lines = [];
    for (const pg of pages) {
      const items = pg.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
      let cur = null;
      for (const it of items) {
        if (cur && Math.abs(cur.y - it.y) <= 4) cur.items.push(it);
        else { cur = { y: it.y, mid: pg.width / 2, items: [it] }; lines.push(cur); }
      }
    }
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    return lines;
  }

  function splitChoices(text) {
    const re = /(?:^|\s)([A-D])[.)]\s+/g;
    const marks = [];
    let want = 0, m;
    while ((m = re.exec(text)) && want < 4) {
      if (m[1] === 'ABCD'[want]) { marks.push({ start: m.index, end: re.lastIndex }); want++; }
    }
    if (marks.length !== 4) return null;
    return marks.map((mk, i) => text.slice(mk.end, i < 3 ? marks[i + 1].start : undefined).trim());
  }

  function parsePages(pages) {
    const questions = [];
    const warnings = [];
    let q = null, state = null, expected = null;

    const finish = () => {
      if (!q) return;
      const label = `Item ${q.num}`;
      const choices = splitChoices((q.L.join(' ') + ' ' + q.R.join(' ')).trim());
      const ans = q.ans.join(' ');
      const letter = (ans.match(/Answer\s*:\s*([A-D])\b/i) || [])[1];
      const keyword = ((ans.match(/Keyword\s*:\s*(.*)$/i) || [])[1] || '').trim();
      const text = q.q.join(' ').trim();
      if (!text) warnings.push(`${label}: question text not found`);
      else if (!choices) warnings.push(`${label}: could not find choices A–D`);
      else if (!letter) warnings.push(`${label}: no "Answer:" line found`);
      else questions.push({
        num: q.num,
        q: text,
        choices,
        correct: 'ABCD'.indexOf(letter.toUpperCase()),
        keyword: keyword || 'No hint yet.'
      });
    };

    for (const ln of toLines(pages)) {
      const t = joinItems(ln.items);
      if (/Page \d+ of \d+$/i.test(t) || /nothing follows/i.test(t)) continue;

      const m = t.match(/^(\d{1,3})\.\s+(.*)$/);
      if (m && (expected === null || +m[1] === expected)) {
        finish();
        q = { num: +m[1], q: [m[2]], L: [], R: [], ans: [] };
        state = 'q';
        expected = q.num + 1;
        continue;
      }
      if (!q) continue; // title / header before the first question

      if (/^Answer\s*:/i.test(t)) { state = 'ans'; q.ans.push(t); continue; }
      if (state === 'q' && /^A[.)]\s/.test(t)) state = 'choices';

      if (state === 'q') q.q.push(t);
      else if (state === 'choices') {
        const L = ln.items.filter(i => i.x < ln.mid);
        const R = ln.items.filter(i => i.x >= ln.mid);
        if (L.length) q.L.push(joinItems(L));
        if (R.length) q.R.push(joinItems(R));
      } else if (state === 'ans') q.ans.push(t);
    }
    finish();
    return { questions, warnings };
  }

  async function parseFile(file) {
    const pdfjsLib = await loadPdfJs();
    const pages = await readPages(new Uint8Array(await file.arrayBuffer()), pdfjsLib);
    return parsePages(pages);
  }

  global.ReviewerPdf = { parseFile, parsePages, readPages };
})(typeof window !== 'undefined' ? window : globalThis);
