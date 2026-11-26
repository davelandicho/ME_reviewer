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

function sound(type) {
  if (muted) return;
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
  { key: 'md',         name: 'Machine Design', icon: '⚙️', file: 'questions.js' },
  { key: 'math',       name: 'Math',           icon: '📐', file: 'questions-math.js' },
  { key: 'powerplant', name: 'Power Plant',    icon: '🏭', file: 'questions-powerplant.js' },
  { key: 'pipe',       name: 'Pipe',           icon: '🔧', file: 'questions-pipe.js' }
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

function allQuestions(sub = $('subject').value) {
  return (BANKS[sub] || []).concat(custom.filter(q => q.subject === sub));
}

function setupSets() {
  const subj = subjectOf($('subject').value);
  $('subjectChip').textContent = `${subj.icon} ${subj.name}`;
  const all = allQuestions();
  const mine = custom.filter(q => q.subject === subj.key).length;
  $('emptyMsg').classList.toggle('hidden', all.length > 0);
  $('start').disabled = all.length === 0;
  const max = Math.max(1, ...all.map(q => q.set || 1));
  $('set').innerHTML = Array.from({ length: max }, (_, i) => {
    const n = all.filter(q => (q.set || 1) === i + 1).length;
    return n ? `<option value="${i + 1}">Set ${i + 1} (${n} questions)</option>` : '';
  }).join('');
  $('footer').textContent = `${subj.name}: ${max} sets • ${all.length} items (${mine} added by you) • Works offline`;
}

function startGame() {
  const source = $('mode').value === 'set'
    ? allQuestions().filter(q => (q.set || 1) === +$('set').value)
    : allQuestions();

  if (!source.length) return;
  pool = shuffle(source.slice());
  const n = $('count').value === 'all' ? pool.length : +$('count').value;
  pool = pool.slice(0, Math.min(n, pool.length));

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

  for (const k of ['fifty', 'hint', 'poll']) $(k).disabled = used[k];
}

function answer(i, btn) {
  if (locked) return;
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
    btn.classList.add('correct', 'pop');
    $('feedback').textContent = 'AYUS TOPNOTCHER! 🎉🔥' + (bonus ? ` +${bonus} STREAK BONUS!` : '');
    sound('ok');
  } else {
    wrong++;
    streak = 0;
    btn.classList.add('wrong', 'shake');
    btns[correctIdx].classList.add('correct');
    $('feedback').textContent = 'BUBU KA INAMO 😭';
    sound('no');
  }

  btns.forEach((b, j) => {
    b.disabled = true;
    if (j !== i && j !== correctIdx) b.classList.add('dim');
  });

  updateHud();
  $('explain').innerHTML =
    `<b>Correct answer:</b> ${escapeHtml(current.choices[current.correct])}<br>` +
    `<b>Keyword:</b> ${escapeHtml(current.keyword)}` +
    (current.explain ? `<br><span class="small">${escapeHtml(current.explain)}</span>` : '');
  $('explain').classList.remove('hidden');
  $('advanceTip').textContent = 'Tap NEXT, press Enter / Space, or tap outside the answers to continue';
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
  $('finalScore').textContent = score + ' pts';

  const acc = pool.length ? Math.round(correct / pool.length * 100) : 0;
  $('stats').innerHTML = `
    <div class="stat"><b>${correct}</b><span>Correct</span></div>
    <div class="stat"><b>${wrong}</b><span>Incorrect</span></div>
    <div class="stat"><b>${acc}%</b><span>Accuracy</span></div>
    <div class="stat"><b>${best}</b><span>Best streak</span></div>`;

  $('rating').textContent =
    acc >= 90 ? '👑 BOARD EXAM MATERIAL!' :
    acc >= 75 ? '🔥 AYUS, MAY PAG-ASA!' :
    acc >= 50 ? '🛠️ ENGINEER IN PROGRESS!' :
                '😭 REVIEW PA, INA MO!';
}

/* ---------- Events ---------- */
$('subject').onchange = () => {
  try { localStorage.setItem('mdReviewerSubject', $('subject').value); } catch (e) {}
  setupSets();
};
$('mode').onchange = () => $('setWrap').classList.toggle('hidden', $('mode').value !== 'set');
$('start').onclick = startGame;
$('next').onclick = advance;
$('again').onclick = () => {
  $('result').classList.add('hidden');
  $('setup').classList.remove('hidden');
};

$('game').addEventListener('click', e => {
  if ($('game').classList.contains('hidden')) return;
  if (locked && !e.target.closest('button')) advance();
});

$('fifty').onclick = () => {
  if (used.fifty || locked) return;
  used.fifty = true;
  const correctIdx = current.display.findIndex(x => x.orig === current.correct);
  const wrongIdx = shuffle([...$('answers').children].map((_, i) => i).filter(i => i !== correctIdx));
  wrongIdx.slice(0, 2).forEach(i => {
    const b = $('answers').children[i];
    b.disabled = true;
    b.classList.add('dim');
  });
  $('lifeline').textContent = '✂️ Two incorrect choices removed!';
  $('fifty').disabled = true;
};

$('hint').onclick = () => {
  if (used.hint || locked) return;
  used.hint = true;
  $('lifeline').textContent = '💡 Hint: ' + current.keyword;
  $('hint').disabled = true;
};

$('poll').onclick = () => {
  if (used.poll || locked) return;
  used.poll = true;
  const correctIdx = current.display.findIndex(x => x.orig === current.correct);
  const weights = current.display.map(() => Math.random() * 25 + 3);
  weights[correctIdx] += Math.random() * 30;
  const total = weights.reduce((a, b) => a + b, 0);
  $('lifeline').textContent = '📊 Audience poll (simulated, may be wrong): ' +
    weights.map((w, i) => `${LETTERS[i]} ${Math.round(w / total * 100)}%`).join(' • ');
  $('poll').disabled = true;
};

$('mute').onclick = () => {
  muted = !muted;
  $('mute').textContent = muted ? '🔇 Muted' : '🔊 Sound';
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
        <div class="meta">${subjectOf(q.subject).icon} ${subjectOf(q.subject).name} • Set ${q.set} • ✅ ${escapeHtml(q.choices[q.correct])}</div>
      </div>
      <div class="acts">
        <button class="btn cyan" data-edit="${q.id}">Edit</button>
        <button class="btn pink" data-del="${q.id}">Delete</button>
      </div>
    </div>`).join('') : '<p class="small">Wala pa. Add your first question above!</p>';
}

function resetForm() {
  const sub = $('fSubject').value;
  $('qForm').reset();
  $('fSubject').value = sub;
  $('editId').value = '';
  $('saveQ').textContent = 'SAVE QUESTION 💾';
  $('cancelEdit').classList.add('hidden');
}

$('openManage').onclick = () => {
  $('fSubject').value = $('exSubject').value = $('subject').value;
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
    $('formMsg').textContent = '⚠️ The 4 choices must be different.';
    return;
  }
  const i = custom.findIndex(x => x.id === q.id);
  if (i >= 0) custom[i] = q; else custom.push(q);
  saveCustom();
  const lastSet = q.set;
  resetForm();
  $('fSet').value = lastSet;
  $('formMsg').textContent = i >= 0 ? '✏️ Question updated!' : '✅ Question added!';
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
    $('saveQ').textContent = 'UPDATE QUESTION ✏️';
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
    $('formMsg').textContent = `⬆️ Imported ${added} new question(s).`;
  } catch (err) {
    $('formMsg').textContent = '⚠️ Could not read that file.';
  }
  $('importFile').value = '';
};

const subjectOptions = SUBJECTS.map(s => `<option value="${s.key}">${s.icon} ${s.name}</option>`).join('');
['subject', 'fSubject', 'exSubject'].forEach(id => { $(id).innerHTML = subjectOptions; });
try {
  const saved = localStorage.getItem('mdReviewerSubject');
  if (SUBJECTS.some(s => s.key === saved)) $('subject').value = saved;
} catch (e) {}

loadCustom();
setupSets();
