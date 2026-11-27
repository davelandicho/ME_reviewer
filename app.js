const $ = id => document.getElementById(id);
const LETTERS = 'ABCD';

let pool = [];
let idx = 0;
let score = 0;
let correct = 0;
let wrong = 0;
let streak = 0;
let best = 0;
let locked = false;
let muted = false;
let used = { fifty: false, hint: false, poll: false };
let current = null;
let gameBoard = null;   // leaderboard this game counts for
let submitted = false;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- Sounds ----------
   Put your meme clips in the sounds/ folder with these names.
   Add or remove names in the lists; a random clip from the list plays each time.
   Missing files are skipped; if none are found, a simple beep plays instead. */
const SOUND_FILES = {
  ok: ['sounds/correct.mp3', 'sounds/correct-1.mp3', 'sounds/correct-2.mp3', 'sounds/correct-3.mp3', 'sounds/correct-4.mp3', 'sounds/correct-5.mp3'],
  no: ['sounds/wrong-1.mp3', 'sounds/wrong-2.mp3', 'sounds/wrong-3.mp3', 'sounds/wrong-4.mp3', 'sounds/wrong-5.mp3']
};
const clips = {};
let playing = null;
for (const [type, files] of Object.entries(SOUND_FILES)) {
  clips[type] = files.map(src => {
    const a = new Audio();
    a.preload = 'auto';
    a.onerror = () => { a.missing = true; };
    a.src = src;
    return a;
  });
}

function stopSound() {
  if (playing) { playing.pause(); playing.currentTime = 0; playing = null; }
}

function sound(type) {
  if (muted) return;
  stopSound();
  const ready = (clips[type] || []).filter(a => !a.missing);
  if (ready.length) {
    const a = ready[Math.floor(Math.random() * ready.length)];
    a.currentTime = 0;
    playing = a;
    a.play().catch(() => { a.missing = true; beep(type); });
    return;
  }
  beep(type);
}

function beep(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.value = type === 'ok' ? 660 : type === 'no' ? 170 : 440;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.start();
    osc.stop(ctx.currentTime + 0.23);
  } catch (e) { /* audio not available */ }
}

/* ---------- Subjects ---------- */
// key: matches BANKS.<key> in the questions file
const SUBJECTS = [
  { key: 'md',         name: 'Machine Design', file: 'questions.js' },
  { key: 'math',       name: 'Math',           file: 'questions-math.js' },
  { key: 'pipe',       name: 'Pipe',           file: 'questions-pipe.js' }
];
window.BANKS = window.BANKS || {};
const subjectOf = key => SUBJECTS.find(s => s.key === key) || SUBJECTS[0];
const norm = t => String(t).trim().toLowerCase();

/* ---------- Custom questions (saved in browser) ---------- */
const STORE_KEY = 'mdReviewerCustomQuestions';
let custom = [];

function loadCustom() {
  try { custom = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { custom = []; }
  custom.forEach(q => { if (!q.subject) q.subject = 'md'; }); // older saves were Machine Design
  // Drop ones that are already in the subject's file (e.g. after you exported & redeployed)
  custom = custom.filter(q => !(BANKS[q.subject] || []).some(b => norm(b.q) === norm(q.q)));
  saveCustom();
}

function saveCustom() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(custom)); } catch (e) { /* storage blocked */ }
}

function renderSubjectTabs() {
  const cur = $('subject').value;
  $('subjectTabs').innerHTML = SUBJECTS.map(s =>
    `<button type="button" data-sub="${s.key}" aria-pressed="${s.key === cur}">${s.name} ` +
    `<span class="count">${allQuestions(s.key).length}</span></button>`).join('');
}

// Sets uploaded from the website (shared with everyone, loaded from /api/sets)
let uploaded = [];

function uploadedQuestions(sub) {
  return uploaded.filter(s => s.subject === sub)
    .flatMap(s => s.questions.map(q => ({ ...q, set: s.set, uploadId: s.id })));
}

function allQuestions(sub = $('subject').value) {
  return (BANKS[sub] || []).concat(uploadedQuestions(sub), custom.filter(q => q.subject === sub));
}

function setupSets() {
  const subj = subjectOf($('subject').value);
  $('subjectChip').textContent = subj.name;
  renderSubjectTabs();
  const all = allQuestions();
  const mine = custom.filter(q => q.subject === subj.key).length;
  $('emptyMsg').classList.toggle('hidden', all.length > 0);
  $('start').disabled = all.length === 0;
  const max = Math.max(1, ...all.map(q => q.set || 1));
  const prev = $('mode').value;
  let opts = `<option value="all">Cover to cover (all ${all.length})</option>`;
  if (max > 1) {
    for (let i = 1; i <= max; i++) {
      const n = all.filter(q => (q.set || 1) === i).length;
      if (n) opts += `<option value="set${i}">Set ${i} (${n})</option>`;
    }
  }
  $('mode').innerHTML = opts;
  if ([...$('mode').options].some(o => o.value === prev)) $('mode').value = prev;
  updateCountVisibility();
  $('footer').textContent = mine ? `${mine} question${mine > 1 ? 's' : ''} added by you in ${subj.name}` : '';
}

// Number of questions only matters when playing one set
function updateCountVisibility() {
  $('countWrap').classList.toggle('hidden', $('mode').value === 'all');
}

function startGame() {
  const mode = $('mode').value;
  const source = mode === 'all'
    ? allQuestions()
    : allQuestions().filter(q => (q.set || 1) === +mode.slice(3));

  if (!source.length) return;
  pool = shuffle(source.slice());
  const n = mode === 'all' || $('count').value === 'all' ? pool.length : +$('count').value;
  pool = pool.slice(0, Math.min(n, pool.length));

  gameBoard = currentBoard();
  submitted = false;
  idx = 0;
  score = correct = wrong = streak = best = 0;
  used = { fifty: false, hint: false, poll: false };

  $('setup').classList.add('hidden');
  $('result').classList.add('hidden');
  $('game').classList.remove('hidden');
  render();
}

function updateHud() {
  $('score').textContent = score;
  $('streak').textContent = streak;
  $('best').textContent = best;
}

function render() {
  locked = false;
  current = pool[idx];

  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
  $('explain').classList.add('hidden');
  $('lifeline').textContent = '';
  $('advanceTip').textContent = '';
  $('next').classList.add('hidden');

  const choices = shuffle(current.choices.map((t, i) => ({ t, orig: i })));
  current.display = choices;

  $('question').textContent = current.q;
  $('qnum').textContent = `Question ${idx + 1} / ${pool.length}`;
  $('bar').style.width = (idx / pool.length * 100) + '%';
  updateHud();

  $('answers').innerHTML = '';
  choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'answer';
    b.innerHTML = `<span class="letter">${LETTERS[i]}</span><span>${escapeHtml(c.t)}</span>`;
    b.onclick = () => answer(i, b);
    $('answers').appendChild(b);
  });

  disarm();
  for (const k of ['fifty', 'hint', 'poll']) $(k).disabled = used[k];
}

function answer(i, btn) {
  if (locked) return;
  disarm();
  locked = true;

  const chosen = current.display[i];
  const correctIdx = current.display.findIndex(x => x.orig === current.correct);
  const btns = [...$('answers').children];

  if (chosen.orig === current.correct) {
    correct++;
    streak++;
    best = Math.max(best, streak);
    const bonus = streak >= 3 ? Math.min((streak - 2) * 25, 200) : 0;
    score += 100 + bonus;
    btn.classList.add('correct');
    $('feedback').textContent = 'Ayus, topnotcher!' + (bonus ? `  +${bonus} streak bonus` : '');
    $('feedback').className = 'feedback ok';
    sound('ok');
  } else {
    wrong++;
    streak = 0;
    btn.classList.add('wrong', 'shake');
    btns[correctIdx].classList.add('correct');
    $('feedback').textContent = 'Bubu ka inamo.';
    $('feedback').className = 'feedback no';
    sound('no');
  }

  btns.forEach((b, j) => {
    b.disabled = true;
    if (j !== i && j !== correctIdx) b.classList.add('dim');
  });

  updateHud();
  $('explain').innerHTML =
    `<b>Answer:</b> ${escapeHtml(current.choices[current.correct])}<br>` +
    `<b>Keyword:</b> ${escapeHtml(current.keyword)}` +
    (current.explain ? `<br><span class="small">${escapeHtml(current.explain)}</span>` : '');
  $('explain').classList.remove('hidden');
  $('advanceTip').textContent = 'Enter / Space, or tap anywhere outside the answers, also works.';
  $('next').classList.remove('hidden');
  $('bar').style.width = ((idx + 1) / pool.length * 100) + '%';
}

function advance() {
  if (!locked) return;
  if (idx + 1 >= pool.length) { finish(); return; }
  idx++;
  render();
}

function finish() {
  $('game').classList.add('hidden');
  $('result').classList.remove('hidden');
  $('finalScore').textContent = score.toLocaleString();

  const acc = pool.length ? Math.round(correct / pool.length * 100) : 0;
  $('stats').innerHTML = `
    <div class="stat"><b>${correct}</b><span>Correct</span></div>
    <div class="stat"><b>${wrong}</b><span>Incorrect</span></div>
    <div class="stat"><b>${acc}%</b><span>Accuracy</span></div>
    <div class="stat"><b>${best}</b><span>Best streak</span></div>`;

  $('rating').textContent =
    acc >= 90 ? 'Board exam material.' :
    acc >= 75 ? 'Ayus, may pag-asa.' :
    acc >= 50 ? 'Engineer in progress.' :
                'Review pa, ina mo.';

  const name = playerName();
  $('saveMsg').textContent = '';
  $('saveName').value = name;
  $('saveWrap').classList.toggle('hidden', !!name);
  $('resultBoardTitle').textContent = boardLabel(gameBoard);
  if (name) submitScore(name);
  else loadBoard(gameBoard, 'resultBoard');
}

/* ---------- Events ---------- */
$('subject').onchange = () => {
  try { localStorage.setItem('mdReviewerSubject', $('subject').value); } catch (e) {}
  setupSets();
};
$('mode').onchange = updateCountVisibility;
$('start').onclick = startGame;
$('next').onclick = advance;
$('again').onclick = () => {
  $('result').classList.add('hidden');
  $('setup').classList.remove('hidden');
  setupSets();
};
$('subjectTabs').onclick = e => {
  const b = e.target.closest('button[data-sub]');
  if (!b) return;
  $('subject').value = b.dataset.sub;
  $('subject').onchange();
};

$('game').addEventListener('click', e => {
  if ($('game').classList.contains('hidden')) return;
  if (locked && !e.target.closest('button')) advance();
});

function useFifty() {
  if (used.fifty || locked) return;
  used.fifty = true;
  const correctIdx = current.display.findIndex(x => x.orig === current.correct);
  const wrongIdx = shuffle([...$('answers').children].map((_, i) => i).filter(i => i !== correctIdx));
  wrongIdx.slice(0, 2).forEach(i => {
    const b = $('answers').children[i];
    b.disabled = true;
    b.classList.add('dim');
  });
  $('lifeline').textContent = 'Two wrong choices removed.';
  $('fifty').disabled = true;
}

function useHint() {
  if (used.hint || locked) return;
  used.hint = true;
  $('lifeline').textContent = 'Hint: ' + current.keyword;
  $('hint').disabled = true;
}

function usePoll() {
  if (used.poll || locked) return;
  used.poll = true;
  const correctIdx = current.display.findIndex(x => x.orig === current.correct);
  const weights = current.display.map(() => Math.random() * 25 + 3);
  weights[correctIdx] += Math.random() * 30;
  const total = weights.reduce((a, b) => a + b, 0);
  $('lifeline').textContent = 'Audience poll (simulated, can be wrong): ' +
    weights.map((w, i) => `${LETTERS[i]} ${Math.round(w / total * 100)}%`).join(' · ');
  $('poll').disabled = true;
}

// Lifelines need a second tap within 3s, so a stray touch doesn't waste one.
const LIFELINES = { fifty: useFifty, hint: useHint, poll: usePoll };
let armed = null, armTimer = null;

function disarm() {
  if (!armed) return;
  const b = $(armed);
  b.textContent = b.dataset.label;
  b.classList.remove('armed');
  armed = null;
  clearTimeout(armTimer);
}

for (const [k, use] of Object.entries(LIFELINES)) {
  const b = $(k);
  b.dataset.label = b.textContent;
  b.onclick = () => {
    if (used[k] || locked) return;
    if (armed === k) { disarm(); use(); return; }
    disarm();
    armed = k;
    b.textContent = 'Tap again';
    b.classList.add('armed');
    armTimer = setTimeout(disarm, 3000);
  };
}

$('mute').onclick = () => {
  muted = !muted;
  $('mute').textContent = muted ? 'Sound off' : 'Sound on';
};

document.addEventListener('keydown', e => {
  if ($('game').classList.contains('hidden')) return;
  if ((e.key === ' ' || e.key === 'Enter') && locked) {
    e.preventDefault();
    advance();
  }
});

/* ---------- Question manager ---------- */
function renderMyList() {
  $('myCount').textContent = custom.length;
  $('myList').innerHTML = custom.length ? custom.map(q => `
    <div class="my-item">
      <div>
        <div>${escapeHtml(q.q)}</div>
        <div class="meta">${subjectOf(q.subject).name} · Set ${q.set} · Answer: ${escapeHtml(q.choices[q.correct])}</div>
      </div>
      <div class="acts">
        <button class="btn small" data-edit="${q.id}">Edit</button>
        <button class="btn small danger" data-del="${q.id}">Delete</button>
      </div>
    </div>`).join('') : '<p class="small">None yet.</p>';
}

function resetForm() {
  const sub = $('fSubject').value;
  $('qForm').reset();
  $('fSubject').value = sub;
  $('editId').value = '';
  $('saveQ').textContent = 'Save question';
  $('cancelEdit').classList.add('hidden');
}

$('openManage').onclick = () => {
  $('fSubject').value = $('exSubject').value = $('upSubject').value = $('subject').value;
  suggestSetNumber();
  renderUploadedList();
  $('setup').classList.add('hidden');
  $('manage').classList.remove('hidden');
  renderMyList();
};
$('closeManage').onclick = () => {
  $('manage').classList.add('hidden');
  $('setup').classList.remove('hidden');
  setupSets();
};
$('cancelEdit').onclick = resetForm;

$('qForm').onsubmit = e => {
  e.preventDefault();
  const choices = [...document.querySelectorAll('.fChoice')].map(i => i.value.trim());
  const q = {
    id: $('editId').value || String(Date.now()),
    subject: $('fSubject').value,
    q: $('fQ').value.trim(),
    choices,
    correct: +document.querySelector('input[name=fCorrect]:checked').value,
    keyword: $('fKey').value.trim() || 'No hint yet.',
    set: Math.max(1, parseInt($('fSet').value, 10) || 1)
  };
  if (!q.q || choices.some(c => !c)) return;
  if (new Set(choices.map(c => c.toLowerCase())).size < 4) {
    $('formMsg').textContent = 'The 4 choices must all be different.';
    return;
  }
  const i = custom.findIndex(x => x.id === q.id);
  if (i >= 0) custom[i] = q; else custom.push(q);
  saveCustom();
  const lastSet = q.set;
  resetForm();
  $('fSet').value = lastSet;
  $('formMsg').textContent = i >= 0 ? 'Question updated.' : 'Question added.';
  renderMyList();
  $('fQ').focus();
};

$('myList').onclick = e => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del;
  if (del && confirm('Delete this question?')) {
    custom = custom.filter(q => q.id !== del);
    saveCustom();
    renderMyList();
  }
  if (ed) {
    const q = custom.find(x => x.id === ed);
    $('editId').value = q.id;
    $('fSubject').value = q.subject;
    $('fSet').value = q.set;
    $('fQ').value = q.q;
    $('fKey').value = q.keyword;
    document.querySelectorAll('.fChoice').forEach((inp, i) => { inp.value = q.choices[i]; });
    document.querySelector(`input[name=fCorrect][value="${q.correct}"]`).checked = true;
    $('saveQ').textContent = 'Update question';
    $('cancelEdit').classList.remove('hidden');
    $('formMsg').textContent = '';
    $('qForm').scrollIntoView({ behavior: 'smooth' });
  }
};

// Builds the full file for one subject (original + your added ones) to drop into the project
$('exportQ').onclick = () => {
  const subj = subjectOf($('exSubject').value);
  const merged = allQuestions(subj.key).map((q, i) => {
    const o = { num: i + 1, q: q.q, choices: q.choices, correct: q.correct, keyword: q.keyword };
    if (q.explain) o.explain = q.explain;
    o.set = q.set || 1;
    return o;
  });
  const text = 'window.BANKS = window.BANKS || {};\nBANKS.' + subj.key + ' = [\n' +
    merged.map(q => '  ' + JSON.stringify(q)).join(',\n') + '\n];\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  a.download = subj.file;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const file = $('importFile').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const list = JSON.parse(json);
    // Imports go into the subject picked in the form (unless the file says otherwise)
    const sub = $('fSubject').value;
    let added = 0;
    list.forEach((q, i) => {
      const subject = q.subject || sub;
      const choices = q.choices || q.opts; // also accepts the GE.html format
      const correct = typeof q.ans === 'string' ? q.ans.trim().charCodeAt(0) - 65 : +q.correct || 0;
      if (!q.q || !Array.isArray(choices) || choices.length !== 4) return;
      if (allQuestions(subject).some(x => norm(x.q) === norm(q.q))) return;
      custom.push({ id: Date.now() + '-' + i, subject, q: q.q, choices, correct, keyword: q.keyword || 'No hint yet.', explain: q.explain || '', set: q.set || 1 });
      added++;
    });
    saveCustom();
    renderMyList();
    $('formMsg').textContent = `Imported ${added} new question(s).`;
  } catch (err) {
    $('formMsg').textContent = 'Could not read that file.';
  }
  $('importFile').value = '';
};

const subjectOptions = SUBJECTS.map(s => `<option value="${s.key}">${s.name}</option>`).join('');
['subject', 'fSubject', 'exSubject', 'upSubject'].forEach(id => { $(id).innerHTML = subjectOptions; });
try {
  const saved = localStorage.getItem('mdReviewerSubject');
  if (SUBJECTS.some(s => s.key === saved)) $('subject').value = saved;
} catch (e) {}

/* ---------- Leaderboard (Netlify Function: /api/leaderboard) ---------- */
const API = '/api/leaderboard';
const NAME_KEY = 'mdReviewerName';

function playerName() { return $('playerName').value.trim().slice(0, 20); }

// One board per subject + set + question count, so scores are comparable
function currentBoard() {
  const scope = $('mode').value;
  return `${$('subject').value}|${scope}|${scope === 'all' ? 'all' : $('count').value}`;
}

function boardLabel(key) {
  const [sub, scope, count] = key.split('|');
  return [subjectOf(sub).name,
          scope === 'all' ? 'Cover to cover' : 'Set ' + scope.slice(3),
          ...(scope === 'all' ? [] : [count === 'all' ? 'All questions' : count + ' questions'])].join(' · ');
}

function drawBoard(listId, entries, myId) {
  $(listId).innerHTML = entries.length ? entries.map((e, i) => `
    <li class="${e.id === myId ? 'me' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="name">${escapeHtml(e.name)}</span>
      <span class="sub">${e.correct}/${e.total}</span>
      <span class="pts">${Number(e.score).toLocaleString()}</span>
    </li>`).join('') : '<li class="empty">No scores yet. Be the first.</li>';
}

function boardError(listId) {
  $(listId).innerHTML = '<li class="empty">Leaderboard is only available on the live (Netlify) site.</li>';
}

async function loadBoard(key, listId, myId) {
  $(listId).innerHTML = '<li class="empty">Loading…</li>';
  try {
    const r = await fetch(`${API}?board=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(r.status);
    drawBoard(listId, (await r.json()).entries, myId);
  } catch (e) { boardError(listId); }
}

async function submitScore(name) {
  if (submitted) return;
  submitted = true;
  $('saveWrap').classList.add('hidden');
  $('saveMsg').textContent = 'Saving score…';
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: gameBoard, name, score, correct, total: pool.length, best })
    });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    $('saveMsg').textContent = `${name}, you placed #${data.rank}.`;
    drawBoard('resultBoard', data.entries, data.id);
  } catch (e) {
    submitted = false;
    $('saveMsg').textContent = 'Could not save your score.';
    boardError('resultBoard');
  }
}

$('playerName').oninput = () => {
  try { localStorage.setItem(NAME_KEY, playerName()); } catch (e) {}
};
$('saveScore').onclick = () => {
  const name = $('saveName').value.trim().slice(0, 20);
  if (!name) { $('saveName').focus(); return; }
  $('playerName').value = name;
  $('playerName').oninput();
  submitScore(name);
};
$('saveName').onkeydown = e => { if (e.key === 'Enter') $('saveScore').click(); };
$('openBoard').onclick = () => {
  $('setup').classList.add('hidden');
  $('boardPanel').classList.remove('hidden');
  $('boardTitle').textContent = boardLabel(currentBoard());
  loadBoard(currentBoard(), 'boardList');
};
$('closeBoard').onclick = () => {
  $('boardPanel').classList.add('hidden');
  $('setup').classList.remove('hidden');
};

try { $('playerName').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}

/* ---------- PDF reviewer upload ---------- */
const SETS_API = '/api/sets';
let parsed = null; // { title, questions, dupes:Set<index> }

async function loadUploadedSets() {
  try {
    const r = await fetch(SETS_API);
    if (!r.ok) return;
    uploaded = (await r.json()).sets || [];
    setupSets();
    if (!$('manage').classList.contains('hidden')) renderUploadedList();
  } catch (e) { /* offline or not on Netlify */ }
}

function suggestSetNumber() {
  const all = allQuestions($('upSubject').value);
  $('upSet').value = all.length ? Math.max(...all.map(q => q.set || 1)) + 1 : 1;
}

function renderUploadedList() {
  $('upList').innerHTML = uploaded.length ? uploaded.map(s => `
    <div class="my-item">
      <div>
        <div>${escapeHtml(s.title || 'Untitled set')}</div>
        <div class="meta">${subjectOf(s.subject).name} · Set ${s.set} · ${s.questions.length} questions</div>
      </div>
      <div class="acts"><button class="btn small danger" data-delset="${s.id}">Delete</button></div>
    </div>`).join('') : '<p class="small">None yet.</p>';
}

function markDuplicates() {
  if (!parsed) return;
  const have = new Set(allQuestions($('upSubject').value).map(q => norm(q.q)));
  parsed.dupes = new Set(parsed.questions.map((q, i) => have.has(norm(q.q)) ? i : -1).filter(i => i >= 0));
  const fresh = parsed.questions.length - parsed.dupes.size;
  $('upSummary').textContent = `Found ${parsed.questions.length} questions` +
    (parsed.dupes.size ? ` · ${parsed.dupes.size} already exist and will be skipped` : '') + ' (tap to check)';
  $('upPreview').innerHTML = parsed.questions.map((q, i) => `
    <li value="${q.num}" class="${parsed.dupes.has(i) ? 'dup' : ''}">${escapeHtml(q.q)}<br>
      <span class="ans">${'ABCD'[q.correct]}. ${escapeHtml(q.choices[q.correct])}</span></li>`).join('');
  $('upPublish').disabled = $('upLocal').disabled = fresh === 0;
}

function freshQuestions() {
  return parsed.questions.filter((_, i) => !parsed.dupes.has(i))
    .map(({ q, choices, correct, keyword }) => ({ q, choices, correct, keyword }));
}

function resetUpload(msg) {
  parsed = null;
  $('upFile').value = '';
  $('upDropText').textContent = 'Drag & drop a PDF here';
  $('upReview').classList.add('hidden');
  $('upMsg').textContent = msg || '';
  suggestSetNumber();
}

$('upSubject').onchange = () => { suggestSetNumber(); markDuplicates(); };

// Drag & drop onto the drop zone
const upDrop = $('upDrop');
['dragenter', 'dragover'].forEach(ev => upDrop.addEventListener(ev, e => {
  e.preventDefault();
  upDrop.classList.add('dragover');
}));
['dragleave', 'dragend', 'drop'].forEach(ev => upDrop.addEventListener(ev, e => {
  if (ev === 'dragleave' && upDrop.contains(e.relatedTarget)) return;
  upDrop.classList.remove('dragover');
}));
upDrop.addEventListener('drop', e => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])][0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    $('upMsg').textContent = 'Please drop a PDF file.';
    return;
  }
  handleUploadFile(file);
});
// Stop the browser from opening a PDF dropped just outside the zone
['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

$('upFile').onchange = () => handleUploadFile($('upFile').files[0]);

async function handleUploadFile(file) {
  $('upReview').classList.add('hidden');
  parsed = null;
  if (!file) return;
  $('upDropText').textContent = file.name;
  $('upMsg').textContent = 'Reading PDF…';
  try {
    const { questions, warnings } = await ReviewerPdf.parseFile(file);
    if (!questions.length) {
      $('upMsg').textContent = 'No questions found. The PDF must have selectable text (not a scanned image) and an “Answer:” line per question.';
      return;
    }
    parsed = { title: file.name.replace(/\.pdf$/i, '').replace(/\s*\(\d+\)$/, ''), questions };
    $('upMsg').textContent = warnings.length
      ? `Skipped ${warnings.length}: ${warnings.slice(0, 5).join('; ')}${warnings.length > 5 ? '…' : ''}`
      : '';
    markDuplicates();
    $('upReview').classList.remove('hidden');
  } catch (e) {
    $('upMsg').textContent = e.message && e.message.includes('PDF reader') ? e.message : 'Could not read that PDF.';
  }
}

$('upPublish').onclick = async () => {
  if (!parsed) return;
  const pin = $('upPin').value.trim();
  if (!pin) { $('upPin').focus(); return; }
  $('upPublish').disabled = true;
  $('upMsg').textContent = 'Publishing…';
  try {
    const r = await fetch(SETS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, subject: $('upSubject').value, set: +$('upSet').value, title: parsed.title, questions: freshQuestions() })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Upload failed. Publishing only works on the live site.');
    uploaded.push(data.set);
    setupSets();
    renderUploadedList();
    resetUpload(`Published ${data.set.questions.length} questions as ${subjectOf(data.set.subject).name} Set ${data.set.set}. Everyone can play it now.`);
  } catch (e) {
    $('upMsg').textContent = e.message;
    $('upPublish').disabled = false;
  }
};

$('upLocal').onclick = () => {
  if (!parsed) return;
  const subject = $('upSubject').value, set = Math.max(1, +$('upSet').value || 1);
  const qs = freshQuestions();
  qs.forEach((q, i) => custom.push({ id: Date.now() + '-' + i, subject, set, ...q }));
  saveCustom();
  setupSets();
  renderMyList();
  resetUpload(`Saved ${qs.length} questions as ${subjectOf(subject).name} Set ${set} in this browser.`);
};

$('upList').onclick = async e => {
  const id = e.target.dataset.delset;
  if (!id) return;
  const pin = $('upPin').value.trim() || prompt('Upload PIN:') || '';
  if (!pin || !confirm('Delete this set for everyone?')) return;
  try {
    const r = await fetch(`${SETS_API}?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-upload-pin': pin } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Delete failed.');
    uploaded = uploaded.filter(s => s.id !== id);
    setupSets();
    renderUploadedList();
  } catch (err) { alert(err.message); }
};

loadCustom();
setupSets();
loadUploadedSets();
