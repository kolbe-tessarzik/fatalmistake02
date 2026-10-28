(() => {
  'use strict';
  const C = window.FatalContent;
  const $ = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + Math.floor(n).toLocaleString('en-US');
  const short = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'm' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.floor(n).toLocaleString('en-US');
  const duration = n => n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.ceil(n % 3600 / 60)}m` : n >= 60 ? `${Math.floor(n / 60)}m ${Math.ceil(n % 60)}s` : `${Math.ceil(Math.max(0, n))}s`;
  const seeded = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return v - Math.floor(v); };
  const SAVE_KEY = 'the-fatal-mistake-v1';
  let renderer;
  try { renderer = new window.FatalRenderer($('world')); }
  catch (error) { $('boot-error').hidden = false; $('boot-error').textContent = error.message; return; }

  function defaultState() {
    return { version: 1, savedAt: Date.now(), cash: 180, tier: 0, completed: [], quests: [], active: null, progress: {}, decisions: {}, upgrades: { agents: 0, marketing: 0, focus: 0 }, focus: 0, reviewCooldown: 0, battery: 75, batteryDead: false, introSeen: false, ending: false, pending: null, lore: [], logs: [], prefs: { sound: false, motion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, pace: 1, assist: false }, stats: { earnings: 0, reviews: 0, falls: 0, outdoorSeconds: 0 } };
  }
  const numeric = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  function normalizeSave(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.completed) || !Array.isArray(raw.quests)) throw new Error('This is not a compatible Fatal Mistake save.');
    const s = defaultState();
    s.cash = numeric(raw.cash, 180, 0, 1e12); s.tier = Math.floor(numeric(raw.tier, 0, 0, 8)); s.savedAt = numeric(raw.savedAt, Date.now(), 0, Date.now());
    s.completed = [...new Set(raw.completed.filter(id => C.projects.some(p => p.id === id)))];
    s.quests = [...new Set(raw.quests.filter(id => Number.isInteger(id) && id >= 0 && id < C.quests.length))];
    for (const p of C.projects) { s.progress[p.id] = numeric(raw.progress?.[p.id], 0, 0, p.work); if (raw.decisions?.[p.id] === 0 || raw.decisions?.[p.id] === 1) s.decisions[p.id] = raw.decisions[p.id]; }
    s.active = C.projects.some(p => p.id === raw.active) && !s.completed.includes(raw.active) ? raw.active : null;
    for (const u of C.upgrades) s.upgrades[u.id] = Math.floor(numeric(raw.upgrades?.[u.id], 0, 0, 5));
    s.focus = numeric(raw.focus, 0, 0, 300); s.reviewCooldown = numeric(raw.reviewCooldown, 0, 0, 180); s.battery = numeric(raw.battery, 75, 0, 75);
    for (const key of ['batteryDead', 'introSeen', 'ending']) s[key] = raw[key] === true;
    if (raw.pending && Number.isInteger(raw.pending.id) && C.quests[raw.pending.id]) s.pending = { id: raw.pending.id, paid: numeric(raw.pending.paid, 0, 0, C.quests[raw.pending.id].fee), replay: raw.pending.replay === true };
    s.lore = Array.isArray(raw.lore) ? [...new Set(raw.lore.filter(id => Number.isInteger(id) && id >= 0 && id < C.lore.length))] : [];
    s.logs = Array.isArray(raw.logs) ? raw.logs.slice(-60).filter(x => x && typeof x.title === 'string' && typeof x.text === 'string').map(x => ({ title: x.title.slice(0, 100), text: x.text.slice(0, 800) })) : [];
    for (const key of ['sound', 'motion', 'assist']) if (typeof raw.prefs?.[key] === 'boolean') s.prefs[key] = raw.prefs[key];
    s.prefs.pace = raw.prefs?.pace === 4 ? 4 : 1;
    for (const key of Object.keys(s.stats)) s.stats[key] = numeric(raw.stats?.[key], 0, 0, 1e12);
    return s;
  }
  let hasSave = false, storageFailed = false, loadWarning = '';
  function readSave() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const parsed = normalizeSave(JSON.parse(raw)); hasSave = true; return parsed; } }
    catch (error) { loadWarning = 'The local save could not be read. A fresh story is ready; exported saves can be imported in Settings.'; }
    return defaultState();
  }
  let state = readSave();
  let scene = 'title', view = 'projects', q = null, modal = null, dirty = true, clock = 0, saveTimer = 0, hudTimer = 0, screenTimer = 0;
  let introIndex = 0, introTime = 0, subtitleUntil = 0, subtitleText = '', subtitleSpeaker = '', toasts = [], particles = [];
  let cameraEye = [12, 9, 15], cameraTarget = [0, 2, 0], lastFrame = performance.now(), hiddenAt = 0, soundtrackTime = 0;
  const keys = new Set(), pressed = new Set();
  const freshPlayer = () => ({ x: 0, y: 0, z: 3, vy: 0, yaw: Math.PI, hp: 110, grounded: true, coyote: .12, jumpBuffer: 0, dash: 0, dashCd: 0, inv: 0, attackCd: 0 });
  let player = freshPlayer();
  let audio = null;
  function unlockAudio() { if (!state.prefs.sound) return; try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume().catch(() => {}); } catch (_) { /* Sound is optional. */ } }
  function tone(frequency = 440, seconds = .12, volume = .035, type = 'sine') {
    if (!audio || audio.state !== 'running' || !state.prefs.sound) return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, t); gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .015); gain.gain.exponentialRampToValueAtTime(.0001, t + seconds); oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(t); oscillator.stop(t + seconds + .02);
  }
  function save() {
    state.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); $('save-label').textContent = '● SAVED ON THIS DEVICE'; }
    catch (_) { $('save-label').textContent = 'SAVE UNAVAILABLE · EXPORT IN SETTINGS'; if (!storageFailed) { storageFailed = true; toast('Browser storage is unavailable. Export your save in Settings to keep progress.'); } }
  }
  function log(title, text) { state.logs.push({ title, text }); state.logs = state.logs.slice(-60); if (view === 'journal') dirty = true; }
  function toast(text) { toasts.push({ text, until: clock + 5 }); toasts = toasts.slice(-4); renderToasts(); }
  function renderToasts() { $('toast-stack').innerHTML = toasts.map(t => `<div class='toast'>${esc(t.text)}</div>`).join(''); }
  function say(text, speaker = 'Narrator', seconds = 7) { subtitleText = text; subtitleSpeaker = speaker; subtitleUntil = seconds === Infinity ? Infinity : clock + seconds; $('subtitle-text').textContent = text; $('speaker').textContent = speaker; }
  function activeProject() { return C.projects.find(p => p.id === state.active); }
  function income() { return C.projects.reduce((sum, p) => sum + (state.completed.includes(p.id) ? p.income * (state.decisions[p.id] === 0 ? 1.18 : 1) : 0), 0) * (1 + state.upgrades.marketing * .1); }
  function buildRate() { return (C.rates[state.tier] || 0) * (1 + state.upgrades.agents * .06) * (state.focus > 0 ? 1.2 : 1); }
  function target(p) { return p.work * (state.decisions[p.id] === 1 ? .9 : 1); }
  function ready(p) { return (state.progress[p.id] || 0) >= target(p); }
  function nextQuest() { return C.quests.find(x => !state.quests.includes(x.id)); }
  function questGate(def) { return def.id === 0 || (def.id === 1 ? state.batteryDead || state.tier >= 2 : state.completed.length >= def.need); }
  function tickEconomy(dt, offline = false) {
    const seconds = dt * state.prefs.pace, earned = income() * seconds;
    state.cash += earned; state.stats.earnings += earned;
    const p = activeProject(); let allowed = seconds;
    if (p && !ready(p) && state.tier >= p.tier) {
      if (state.tier === 1) {
        allowed = Math.min(seconds, state.battery); state.battery = Math.max(0, state.battery - seconds);
        if (!state.battery && !state.batteryDead) {
          state.batteryDead = true; dirty = true; log('A magnetic personality', 'The laptop works. Its battery does not work indefinitely. Its charger is magnetic, proprietary, and in a monastery. Naturally.');
          if (!offline) { toast('Battery empty. Magnetic adapter quest unlocked.'); say('It uses a magnetic charger. Of course it does. Time for another entirely normal procurement expedition.', 'FatalMistake02', 10); }
        }
      }
      if (!state.batteryDead || state.tier >= 2 || allowed > 0) {
        const before = state.progress[p.id] || 0;
        state.progress[p.id] = Math.min(target(p), before + allowed * buildRate() * (offline ? .35 : 1));
        if (before < target(p) && ready(p)) { dirty = true; if (!offline) { toast(p.id === 'chess' ? 'The chess bot is ready for its tournament.' : `${p.name} is ready to launch.`); tone(660, .3); } }
        if (before < p.work * .35 && state.progress[p.id] >= p.work * .35) dirty = true;
      }
    }
    state.focus = Math.max(0, state.focus - seconds); state.reviewCooldown = Math.max(0, state.reviewCooldown - seconds);
  }
  function applyOffline(seconds) {
    seconds = clamp(seconds, 0, 7200); const before = state.cash;
    for (let remaining = seconds; remaining > 0; remaining -= 20) tickEconomy(Math.min(20, remaining), true);
    if (seconds > 30 && (state.cash > before || state.active)) toast(`Welcome back. ${money(state.cash - before)} earned while away; builds ran at 35% speed.`);
  }

  function setModal(data) { modal = data; keys.clear(); pressed.clear(); renderModal(); }
  function closeModal() { modal = null; $('modal-root').innerHTML = ''; keys.clear(); pressed.clear(); }
  function dialog(title, text, label = 'Continue', onOK = null) { setModal({ kind: 'dialog', title, html: `<p>${esc(text)}</p>`, label, onOK }); }
  function renderModal() {
    if (!modal) { $('modal-root').innerHTML = ''; return; }
    let html = modal.html || '', title = modal.title || '', footer = '', wide = false;
    if (modal.kind === 'settings') {
      title = 'Take a breath.';
      html = `<p>The world, and its very expensive upgrades, can wait.</p><div class='settings-row'><div><b>Synthesized sound</b><small>A quiet, procedural soundtrack. No external audio files.</small></div><button class='mini-button' data-act='sound'>${state.prefs.sound ? 'ON' : 'OFF'}</button></div><div class='settings-row'><div><b>Build pace</b><small>Normal is designed for several hours. Story pace makes builds and income four times faster.</small></div><button class='mini-button' data-act='pace'>${state.prefs.pace === 1 ? 'NORMAL' : 'STORY ×4'}</button></div><div class='settings-row'><div><b>Reduced motion</b><small>Stops decorative bobbing, particles, and camera easing.</small></div><button class='mini-button' data-act='motion'>${state.prefs.motion ? 'ON' : 'OFF'}</button></div><div class='settings-row'><div><b>Quest assistance</b><small>Gentler combat and detection, automatic rhythm notes, and optional circuit solving.</small></div><button class='mini-button' data-act='assist'>${state.prefs.assist ? 'ON' : 'OFF'}</button></div><p class='muted'>Builds earn offline for up to two hours, at 35% development speed. Revenue earns at full speed. Interrupted expeditions refund their travel ticket.</p><div class='button-row'><button class='secondary' data-act='export'>Export save</button><button class='secondary' data-act='import'>Import save</button><button class='danger' data-act='reset'>New story</button><input id='import-file' type='file' accept='application/json,.json' hidden></div>`;
      footer = `<button class='primary' data-act='resume'>Resume ↗</button>`;
    } else if (modal.kind === 'tactics') {
      title = 'A very technical disagreement.';
      const t = q.tactics, disabled = t.wait > 0 ? 'disabled' : '';
      html = `<div class='eyebrow'>CODEX vs COPILOT · TURN ${t.turn}</div><div class='combat-bars'><div><b>FatalMistake02</b><div class='meter'><div style='width:${t.hp}%'></div></div><small>${t.hp}/100 HP · ${t.energy}/10 compute</small></div><div><b>Xavier</b><div class='meter danger-meter'><div style='width:${t.enemy / 150 * 100}%'></div></div><small>${Math.max(0, t.enemy)}/150 HP · unearned confidence</small></div></div><div class='combat-message'>${esc(t.message)}</div><div class='tactic-grid'><button data-act='tactic' data-move='swarm' ${disabled}>Agent swarm<small>32 damage · 3 compute</small></button><button data-act='tactic' data-move='think' ${disabled}>Deep think<small>48 damage · 4 compute</small></button><button data-act='tactic' data-move='prompt' ${disabled}>Prompt strike<small>18 damage · gain 2 compute</small></button><button data-act='tactic' data-move='patch' ${disabled}>Patch & shield<small>Heal 16 · gain 3 compute</small></button></div><p class='muted'>Codex tools are fictional combat abilities. Xavier has brought autocomplete to a boss fight.</p>`;
    } else if (modal.kind === 'puzzle') {
      title = 'The memory palace'; const p = q.puzzle;
      html = `<div class='eyebrow'>SECTOR ${p.stage + 1} / 3 · ${p.moves} SWITCHES</div><p>Turn every tile off. A switch flips itself and its neighbors above, below, left, and right.</p><div class='circuit-grid' style='grid-template-columns:repeat(${p.size},1fr)'>${p.board.map((on, i) => `<button class='circuit-cell ${on ? 'on' : ''} ${p.hint === i ? 'hinted' : ''}' data-act='tile' data-index='${i}' aria-label='Row ${Math.floor(i / p.size) + 1}, column ${i % p.size + 1}' aria-pressed='${!!on}'>${on ? '✦' : '·'}</button>`).join('')}</div><div class='button-row'><button class='secondary' data-act='circuit-hint'>Show a useful switch</button><button class='secondary' data-act='circuit-reset'>Reset sector</button>${state.prefs.assist ? `<button class='secondary' data-act='circuit-solve'>Assist: solve sector</button>` : ''}</div><p class='muted'>No move limit. Every board is generated from a solved state.</p>`;
    } else if (modal.kind === 'rhythm') {
      title = 'Thirty Percent PWM'; wide = true;
      html = `<div class='eyebrow'>THE FAN CLUB · LIVE COOLING PERFORMANCE</div><p>Press <b>D F J K</b> as the notes reach the mint line. Or tap the buttons below. Reach 45% accuracy.</p><div class='rhythm-stats'><span id='rhythm-score'>0% accuracy</span><span id='rhythm-feedback'>Get ready…</span><span id='rhythm-time'>84s</span></div><canvas id='rhythm-canvas' width='700' height='300' aria-label='Four rhythm lanes'></canvas><div class='tactic-grid' style='grid-template-columns:repeat(4,1fr);margin-top:10px'>${['D', 'F', 'J', 'K'].map((k, i) => `<button data-act='rhythm-hit' data-lane='${i}' style='text-align:center'>${k}</button>`).join('')}</div><p class='muted'>Escape pauses. Assistance in Settings can play the notes for you.</p>`;
    } else if (modal.kind === 'ending') {
      title = 'Hello, Mira.';
      html = `<div class='ending-copy'><img class='ending-logo' src='mira.png' alt='Mira logo'><div class='eyebrow' style='justify-content:center'>THE FATAL MISTAKE · FIN</div><p>He went outside for a computer.<br>He came back with a reason to make something.</p><p>Mira opens its first tab. No blue screen.<br>Somewhere, Xavier bookmarks the download page.</p><div class='stat-grid'><div><strong>12</strong><small>IDEAS FINISHED, MORE OR LESS</small></div><div><strong>${state.lore.length}/24</strong><small>PIECES OF QUESTIONABLE LORE</small></div></div><p class='muted'>Fatal opens the curtains. The sky is cloudy.<br>He turns the brightness up.</p></div>`;
      footer = `<button class='primary full' data-act='ending-home'>One more tab ↗</button>`;
    } else if (modal.kind === 'review') {
      const p = activeProject(); if (!p) { closeModal(); return; }
      title = 'A second pair of eyes.';
      html = `<div class='eyebrow'>${esc(p.name)} · OPTIONAL CODE REVIEW</div><p>${esc(p.review.question)}</p>${p.review.options.map((text, i) => `<button class='choice' data-act='review-answer' data-choice='${i}'>${esc(text)}</button>`).join('')}`;
    } else if (modal.kind === 'decision') {
      const p = activeProject(); if (!p) { closeModal(); return; }
      title = 'Choose a direction.';
      html = `<div class='eyebrow'>${esc(p.name)} · DESIGN MILESTONE</div><p>There is room for one delightfully unnecessary improvement.</p>${p.decisions.map((text, i) => `<button class='choice' data-act='decision-answer' data-choice='${i}'>${esc(text)}<small>${i === 0 ? '+18% recurring income after launch.' : 'Reduce this project’s remaining target by 10% of its original build.'}</small></button>`).join('')}`;
    } else if (modal.kind === 'archive') {
      const pad = C.archive[modal.index]; title = pad.name + ' beacon';
      html = `<div class='eyebrow'>THE ARCHIVE ASKS</div><p>${esc(pad.question)}</p>${pad.options.map((text, i) => `<button class='choice' data-act='archive-answer' data-choice='${i}'>${esc(text)}</button>`).join('')}<p class='muted'>${esc(modal.feedback || 'The archive values a considered answer more than a fast one.')}</p>`;
    }
    if (modal.kind === 'dialog') footer = `<button class='primary' data-act='modal-ok'>${esc(modal.label || 'Continue')} ↗</button>`;
    $('modal-root').innerHTML = `<div class='scrim'><section class='modal ${wide ? 'wide' : ''}' role='dialog' aria-modal='true' aria-labelledby='modal-title'><div class='eyebrow'>THE FATAL MISTAKE</div><h2 id='modal-title'>${esc(title)}</h2>${html}${footer ? `<div class='modal-footer'>${footer}</div>` : ''}</section></div>`;
    $('modal-root').querySelector('button')?.focus({ preventScroll: true });
  }
  function settings() { if (modal?.kind === 'settings') return; const previous = modal; setModal({ kind: 'settings', previous }); }
  function resume() { const previous = modal?.previous || null; modal = previous; keys.clear(); pressed.clear(); renderModal(); save(); }

  function panelHeading(title, tag) { return `<div class='panel-heading'><div><div class='tiny-label'>FATAL’S STUDIO</div><h2>${title}</h2></div><span class='tag'>${tag}</span></div>`; }
  function renderPanel() {
    const element = $('panel-content'), scroll = $('studio-panel').scrollTop;
    let html = '';
    if (view === 'projects') {
      html = panelHeading('Questionable ideas.', `${state.completed.length} / 12`);
      const p = activeProject(), expedition = nextQuest();
      if (p) {
        const stopped = state.batteryDead && state.tier < 2;
        html += `<div class='studio-card'><div class='card-top'><span class='tiny-label'>${ready(p) ? 'READY FOR THE WORLD' : 'CURRENTLY VIBE-CODING'}</span><span class='status-chip'>${stopped ? 'NO POWER' : 'LOCAL BUILD'}</span></div><h3>${esc(p.name)}</h3><p class='muted'>${esc(p.subtitle)}</p><div class='progress-track'><div id='build-progress'></div></div><div class='progress-meta'><span id='build-percent'></span><span id='build-eta'></span></div>${ready(p) ? `<button class='primary full' data-act='publish'>${p.id === 'chess' ? 'Run the tournament' : p.id === 'mira' ? 'Launch Mira' : 'Ship ' + esc(p.name)} ↗</button>` : stopped ? `<button class='primary full' data-act='view' data-view='expeditions'>Find a magnetic charger ↗</button>` : `<button id='review-button' class='secondary full' data-act='review'>Review a build</button><small class='muted' id='focus-state'></small>`}${state.decisions[p.id] === undefined && (state.progress[p.id] || 0) >= p.work * .35 ? `<button class='text-button' data-act='decision'>✦ Design milestone ready</button>` : ''}</div>`;
      } else {
        const pNext = C.projects.find(pj => !state.completed.includes(pj.id));
        html += `<div class='studio-card'><div class='tiny-label'>${state.ending ? 'ONE VERY GOOD WINDOW' : 'NEXT BIG IDEA'}</div><h3>${pNext ? esc(pNext.name) : 'You made Mira.'}</h3><p class='muted'>${pNext ? esc(pNext.subtitle) : 'The studio is still here. The world is a little bigger.'}</p>${pNext && state.tier >= pNext.tier ? `<button class='primary full' data-act='start-project' data-id='${pNext.id}'>Start vibe-coding ↗</button>` : expedition ? `<button class='primary full' data-act='view' data-view='expeditions'>Find better hardware ↗</button>` : ''}</div>`;
      }
      html += `<div class='tiny-label'>${esc(C.hardware[state.tier])} · <span id='build-rate-label'>${buildRate().toFixed(2)}×</span> BUILD SPEED</div><div class='section-label'>THE LAUNCH ROADMAP</div>`;
      C.projects.forEach((pj, i) => {
        const done = state.completed.includes(pj.id), available = state.tier >= pj.tier && (i === 0 || state.completed.includes(C.projects[i - 1].id));
        html += `<div class='project-row ${!available && !done ? 'locked' : ''}'><div class='project-icon'>${pj.icon}</div><div class='project-info'><b>${esc(pj.name)}</b><small>${done ? pj.income ? `${money(pj.income * (state.decisions[pj.id] === 0 ? 1.18 : 1) * (1 + state.upgrades.marketing * .1))}/sec · live` : 'Tournament disaster · archived' : state.active === pj.id ? 'In development' : available ? `${duration(pj.work / Math.max(.1, buildRate()) / state.prefs.pace)} base build` : `Needs ${esc(C.hardware[pj.tier])}`}</small></div>${done ? `<span class='done'>✓</span>` : available && !state.active ? `<button class='mini-button' data-act='start-project' data-id='${pj.id}'>Build</button>` : ''}</div>`;
      });
    } else if (view === 'workshop') {
      html = panelHeading('Better little habits.', 'UPGRADES') + `<p class='muted'>The computer comes from an adventure. The imaginary management skills come from here.</p><div class='studio-card'><span class='tiny-label'>WORKSTATION</span><h3>${esc(C.hardware[state.tier])}</h3><p class='muted'>${buildRate().toFixed(2)}× current build rate · ${state.prefs.pace === 4 ? 'Story pace ×4' : 'Normal campaign pace'}</p></div>`;
      if (!state.completed.includes('cardly')) html += `<p class='muted'>Workshop purchases open after Cardly’s first launch. The magnetic charger budget is protected until then.</p>`;
      for (const u of C.upgrades) { const level = state.upgrades[u.id], price = Math.round(u.base * u.factor ** level); html += `<div class='upgrade'><div class='tiny-label'>LEVEL ${level} / 5</div><h3>${u.name}</h3><p>${u.description}</p><button class='mini-button' data-act='upgrade' data-id='${u.id}' ${level >= 5 || !state.completed.includes('cardly') ? 'disabled' : ''}>${level >= 5 ? 'Fully upgraded' : 'Upgrade · ' + money(price)}</button></div>`; }
    } else if (view === 'expeditions') {
      const next = nextQuest(); html = panelHeading('Go touch adventure.', `${state.quests.length} / 8`);
      if (next) html += `<div class='quest-card'><div class='tiny-label'>${next.genre}</div><h3>${next.name}</h3><p>${next.description}</p><p class='muted'>REWARD: ${esc(C.hardware[next.id + 1])}</p>${questGate(next) ? `<button class='primary full' data-act='quest' data-id='${next.id}'>${next.fee ? 'Travel · ' + money(next.fee) : 'Step outside · Free'} ↗</button>` : `<p class='muted'>${next.id === 1 ? 'Start Cardly and use the laptop. Its battery has about 75 coding seconds left.' : `Launch ${next.need} projects first (${state.completed.length}/${next.need}).`}</p>`}</div>`;
      else html += `<div class='studio-card'><h3>Every window is open.</h3><p class='muted'>All equipment found. Expeditions can still be replayed for missing lore.</p></div>`;
      html += `<p class='muted'>Travel fees are refunded if you retreat or reload before finishing. Development and revenue continue during expeditions.</p><div class='section-label'>THE PLACES YOU SURVIVED</div>`;
      for (const id of state.quests) { const def = C.quests[id]; html += `<div class='quest-card'><div class='tiny-label'>${def.genre}</div><h3>${def.name}</h3><button class='mini-button' data-act='replay' data-id='${id}'>Replay · Free</button></div>`; }
    } else {
      html = panelHeading('Patch notes for a life.', 'JOURNAL') + `<div class='title-profile' style='margin:0 0 15px'><img src='FatalMistake02.png' alt='FatalMistake02'><div><b>FatalMistake02</b><span>16 · blond · conditionally outdoors</span></div></div><div class='stat-grid'><div><strong>${state.completed.length}</strong><small>PROJECTS RELEASED</small></div><div><strong>${state.lore.length}/24</strong><small>LORE FOUND</small></div><div><strong>${short(state.stats.earnings)}</strong><small>LIFETIME EARNINGS</small></div><div><strong>${Math.floor(state.stats.outdoorSeconds / 60)}m</strong><small>EXPOSURE TO OUTSIDE</small></div></div><div class='section-label'>COLLECTED NONSENSE</div>`;
      html += state.lore.length ? state.lore.map(id => `<div class='lore-entry'><b>${esc(C.lore[id][0])}</b><br>${esc(C.lore[id][1])}</div>`).join('') : `<p class='muted'>Find golden sparks on expeditions to collect the forest’s questionable documentation.</p>`;
      html += `<div class='section-label'>STORY LOG</div>` + state.logs.slice().reverse().map(entry => `<div class='log-entry'><b>${esc(entry.title)}</b><p>${esc(entry.text)}</p></div>`).join('');
    }
    element.innerHTML = html; $('studio-panel').scrollTop = scroll; dirty = false;
    document.querySelectorAll('#dock button').forEach(b => b.classList.toggle('selected', b.dataset.view === view));
  }
  function syncUI() {
    document.body.dataset.scene = scene; document.body.classList.toggle('reduce-motion', state.prefs.motion);
    $('title-screen').hidden = scene !== 'title'; $('studio-panel').hidden = scene !== 'home'; $('dock').hidden = scene !== 'home'; $('quest-hud').hidden = scene !== 'quest'; $('minimap').hidden = scene !== 'quest'; $('skip-intro').hidden = scene !== 'intro';
    $('touch-controls').hidden = scene !== 'quest' || !window.matchMedia('(pointer:coarse)').matches;
    $('title-actions').innerHTML = hasSave && state.introSeen ? `<button class='primary' data-act='continue'>Continue the mistake ↗</button><button class='secondary' data-act='reset'>New story</button>` : `<button class='primary' data-act='begin'>Begin the mistake ↗</button>`;
    $('help-text').textContent = scene === 'home' ? 'Build something. Break a computer. Venture outside.' : scene === 'quest' ? 'WASD / arrows · E use · Space action · Shift dash / crouch · Esc pause' : scene === 'intro' ? 'Space / Enter to advance · Esc to pause' : 'A game about going outside. Eventually.';
    dirty = true;
  }
  function home() { scene = 'home'; q = null; closeModal(); player = freshPlayer(); view = 'projects'; syncUI(); save(); }
  function begin() { unlockAudio(); if (state.introSeen) { home(); return; } scene = 'intro'; introIndex = 0; introTime = 0; setIntroLine(); syncUI(); }
  function setIntroLine() { const item = C.intro[introIndex]; say(item.text, item.speaker, Infinity); }
  function advanceIntro() {
    introIndex++; introTime = 0;
    if (introIndex >= C.intro.length) {
      state.introSeen = true; log('An extremely normal morning', 'Fatal wakes up, asks what to vibe-code, and is greeted by a blue screen. A new computer must be acquired through an ancient method called leaving the house.'); startQuest(0); return;
    }
    setIntroLine(); if (C.intro[introIndex].pose === 'crash') tone(110, .6, .035, 'triangle');
  }
  function skipIntro() { state.introSeen = true; log('The first fatal mistake', 'A cheerful greeting became a blue screen. Fatal needs a new computer. The outdoors has been reluctantly selected as the supplier.'); startQuest(0); }
  function startProject(id) {
    const index = C.projects.findIndex(p => p.id === id), p = C.projects[index];
    if (!p || state.active || state.completed.includes(id) || state.tier < p.tier || index > 0 && !state.completed.includes(C.projects[index - 1].id)) return;
    state.active = id; state.progress[id] = state.progress[id] || 0; dirty = true; save(); say(id === 'cardly' ? 'The laptop works! I’ll start Cardly. What could possibly happen to a battery-powered device with no charger?' : `Next up: ${p.name}. This one is definitely a reasonable scope.`, 'FatalMistake02', 8);
  }
  function publish() {
    const p = activeProject(); if (!p || !ready(p)) return;
    if (state.decisions[p.id] === undefined) state.decisions[p.id] = 0;
    state.completed.push(p.id); state.cash += p.payout; state.stats.earnings += p.payout; state.active = null; log(p.name, p.story); dirty = true; save(); tone(783.99, .5);
    if (p.id === 'chess') dialog('Checkmate. Against himself.', p.story + ' Sponsorship sympathy pays ' + money(p.payout) + ', but the bot earns no recurring income. The final expedition is now available.', 'Find the last component');
    else if (p.id === 'mira') { state.ending = true; save(); burst({ x: 0, y: 3, z: 0 }, '#cbb1ff', 50); setModal({ kind: 'ending' }); }
    else { toast(`${p.name} shipped · ${money(p.payout)} launch bonus`); say(p.story, 'Launch notes', 10); }
  }
  function buyUpgrade(id) {
    const u = C.upgrades.find(x => x.id === id); if (!u || !state.completed.includes('cardly') || state.upgrades[id] >= 5) return;
    const price = Math.round(u.base * u.factor ** state.upgrades[id]); if (state.cash < price) { toast('A little more revenue first. The imaginary chairs are surprisingly expensive.'); return; }
    state.cash -= price; state.upgrades[id]++; dirty = true; save(); tone(523, .2);
  }
  function openReview() { if (!state.active || ready(activeProject()) || state.reviewCooldown > 0) return; state.reviewCooldown = 70; setModal({ kind: 'review' }); }
  function reviewAnswer(choice) {
    const p = activeProject(); if (!p || modal?.kind !== 'review') return;
    const correct = choice === p.review.answer; state.stats.reviews++; state.focus = correct ? 90 + state.upgrades.focus * 15 : 20;
    const bonus = correct ? 25 + C.projects.indexOf(p) * 20 : 0; state.cash += bonus; state.stats.earnings += bonus;
    dialog(correct ? 'A surprisingly solid review.' : 'An educational mistake.', p.review.explanation + (correct ? ` Focus boosted for ${duration(state.focus)}. ${money(bonus)} review bonus.` : 'You still get twenty seconds of encouragement.'), 'Back to the build'); dirty = true; save();
  }

  function addPickups(positions, offset) { return positions.map((pos, i) => ({ x: pos[0], y: pos[1], z: pos[2], lore: offset + i, kind: 'lore', taken: state.lore.includes(offset + i) })); }
  function startQuest(id, replay = false) {
    const def = C.quests[id]; if (!def) return;
    if (replay && !state.quests.includes(id) || !replay && (!questGate(def) || state.quests.includes(id))) return;
    const fee = replay ? 0 : def.fee;
    if (state.cash < fee) { toast(`Travel needs ${money(fee)}. Published projects keep earning while you wait.`); return; }
    state.cash -= fee; state.pending = { id, paid: fee, replay }; closeModal(); scene = 'quest'; setupQuest(id); subtitleUntil = 0; syncUI(); save(); say(def.tutorial, 'Field notes', 11);
  }
  function setupQuest(id) {
    const def = C.quests[id]; player = freshPlayer();
    q = { id, def, type: def.type, mode: def.type, t: 0, finished: false, pickups: [], obstacles: [], trees: [], checkpoint: { x: 0, y: 0, z: 3 }, checkpointIndex: 0, enemy: { x: 0, y: 0, z: -112, hp: 140 }, milestones: new Set(), attacks: [], enemies: [], bolts: [], hazardTimer: 4, spawnTimer: 1, access: 0 };
    if (q.type === 'woods') {
      for (let i = 0; i < 85; i++) { const z = 9 - seeded(i + 80) * 144, path = Math.sin(z * .045) * 4, side = i % 2 ? 1 : -1, x = path + side * (6 + seeded(i + 10) * 19); q.trees.push({ x, z, size: .8 + seeded(i + 4) * .8 }); q.obstacles.push({ x, z, w: .8, d: .8 }); }
      q.pickups = addPickups([[-2, 1, -15], [6, 1, -46], [-5, 1, -84]], 0);
    } else if (q.type === 'platform') {
      q.platforms = [{ x: 0, y: 0, z: 3, w: 7, d: 7 }];
      for (let i = 1; i <= 16; i++) q.platforms.push({ x: Math.sin(i * .85) * 3, y: (i % 4) * .28, z: 3 - i * 4.6, w: i % 4 === 0 ? 5 : 3.7, d: 3.6 });
      q.goal = { ...q.platforms[16] }; q.pickups = addPickups([4, 8, 12].map(i => [q.platforms[i].x, q.platforms[i].y + 1, q.platforms[i].z]), 3);
    } else if (q.type === 'stealth') {
      for (let i = 0; i < 7; i++) { const z = -5 - i * 7; q.obstacles.push({ x: i % 2 ? -3 : 3, z, w: 4.2, d: 2.1 }); }
      q.bots = [-12, -26, -40].map((z, i) => ({ x: 0, z, yaw: Math.PI / 2, phase: i * 1.7 })); q.detection = 0;
      q.pickups = addPickups([[-10, 1, -8], [10, 1, -24], [-10, 1, -43]], 6);
      q.pickups.push(...[[-9, -17], [9, -32], [-8, -47]].map((a, i) => ({ x: a[0], y: 1, z: a[1], kind: 'key', key: i, taken: false })));
    } else if (q.type === 'puzzle') {
      q.puzzle = { stage: 0 }; createCircuit(); setModal({ kind: 'puzzle' });
    } else if (q.type === 'rhythm') {
      q.rhythm = { time: 0, notes: [], hit: 0, perfect: 0, misses: 0, feedback: 'Get ready…', flash: [0, 0, 0, 0] };
      for (let i = 0; i < 165; i++) { q.rhythm.notes.push({ t: 3 + i * .46, lane: (i * 3 + Math.floor(i / 8)) % 4, result: 0 }); if (i % 19 === 12) q.rhythm.notes.push({ t: 3 + i * .46, lane: ((i * 3 + Math.floor(i / 8)) + 2) % 4, result: 0 }); }
      setModal({ kind: 'rhythm' });
    } else if (q.type === 'race') {
      q.integrity = 100; q.raceHit = 0; q.deliveries = 0;
      q.barriers = Array.from({ length: 44 }, (_, i) => ({ x: [-4, 0, 4][Math.floor(seeded(i + 14) * 3)], z: -22 - i * 19, hit: false }));
      q.pickups = addPickups([[-4, 1, -150], [4, 1, -450], [0, 1, -750]], 15);
    } else if (q.type === 'survival') {
      q.survivalTime = 0; q.keys = 0; q.keysSpawned = 0; q.playerHit = 0; q.pickups = addPickups([[-11, 1, -10], [11, 1, -9], [0, 1, 11]], 18);
    } else if (q.type === 'archive') {
      q.seals = 0; q.pickups = addPickups([[-14, 1, -3], [14, 1, -13], [-4, 1, -28]], 21);
    }
  }
  function finishQuest() {
    if (!q || q.finished) return; q.finished = true;
    const def = q.def, replay = state.pending?.replay;
    if (!replay) { if (!state.quests.includes(q.id)) state.quests.push(q.id); state.tier = Math.max(state.tier, q.id + 1); if (q.id >= 1) state.batteryDead = false; }
    const reward = Math.round(def.reward * (replay ? .12 : 1)); state.cash += reward; state.stats.earnings += reward; state.pending = null;
    log(def.name, replay ? 'Returned for another expedition and the documentation nobody asked for.' : `Recovered ${C.hardware[q.id + 1]}. The bedroom hardware supply chain remains deeply unreasonable.`);
    if (q.type === 'puzzle' || q.type === 'rhythm') for (let i = q.id * 3; i < q.id * 3 + 3; i++) if (!state.lore.includes(i)) state.lore.push(i);
    save();
    const text = q.id === 0 ? 'Xavier surrenders, announces that swords are in beta, and runs away. He drops a laptop. Fatal brings it home. It boots! Somewhere in its battery controller, a countdown begins.' : q.id === 7 ? 'The archive releases a prism core. Fatal has the last component. The chess bot may have failed, but its developer has one more idea: Mira.' : `You recovered ${C.hardware[q.id + 1]}. ${money(reward)} in salvage funds has been added to the studio. The next project is waiting.`;
    dialog(replay ? 'Another successful bad idea.' : q.id === 0 ? 'A laptop, gently abandoned.' : 'Hardware acquired.', text, 'Back to the bedroom', home);
  }
  function retreat() { if (!q) return; const previous = modal; dialog('Head home?', 'Your travel ticket will be refunded. This expedition restarts next time; collected lore and studio progress are kept.', 'Return home', () => { state.cash += state.pending?.paid || 0; state.pending = null; home(); }); modal.html += `<button class='secondary' data-act='cancel-retreat'>Stay on the expedition</button>`; modal.previousQuestModal = previous; renderModal(); }
  function retryQuest() { const id = q.id; closeModal(); setupQuest(id); say(q.def.tutorial, 'Try again', 8); }
  function resetToCheckpoint() { player.x = q.checkpoint.x; player.y = q.checkpoint.y + .05; player.z = q.checkpoint.z; player.vy = 0; player.grounded = true; player.inv = 1; state.stats.falls++; tone(180, .15); say('A checkpoint politely catches your entire life. The canyon files no complaint.', 'Narrator', 4); }
  function burst(pos, tint, count = 12) { if (state.prefs.motion) return; for (let i = 0; i < count; i++) particles.push({ x: pos.x, y: pos.y + 1, z: pos.z, vx: (seeded(i + clock) - .5) * 6, vy: 2 + seeded(i + 11) * 3, vz: (seeded(i + 21) - .5) * 6, t: .7 + seeded(i) * .5, tint }); particles = particles.slice(-100); }
  function collectPickups() {
    for (const item of q.pickups) if (!item.taken && distance(player, item) < 1.4 && Math.abs(player.y + 1 - item.y) < 2) {
      item.taken = true; tone(880, .15); burst(item, item.kind === 'lore' ? '#ffd68c' : '#f2a8db');
      if (item.kind === 'lore') { if (!state.lore.includes(item.lore)) { state.lore.push(item.lore); const reward = 25 * (q.id + 1); state.cash += reward; state.stats.earnings += reward; toast(`Lore found: ${C.lore[item.lore][0]} · ${money(reward)}`); say(C.lore[item.lore][1], 'Field documentation', 7); save(); } }
      else if (q.type === 'stealth') { q.access++; toast(`Access card ${q.access}/3`); }
      else if (q.type === 'survival') { q.keys++; toast(`Cancellation key ${q.keys}/3`); }
    }
  }

  function enterTactics() {
    q.mode = 'tactics'; q.obstacles = []; player.x = -3; player.z = -112; player.yaw = Math.PI / 2; q.enemy.x = 3; q.enemy.z = -112;
    q.tactics = { hp: 100, enemy: 150, energy: 6, turn: 1, wait: 0, shield: false, message: 'Xavier: “My Copilot has already suggested your surrender.”' };
    setModal({ kind: 'tactics' }); say('Your mortal enemy: Xavier. A round kid, a black bowl cut, and the confidence of an unchecked suggestion.', 'Narrator', 9);
  }
  function tactic(move) {
    if (q?.mode !== 'tactics' || modal?.kind !== 'tactics' || q.tactics.wait) return;
    const t = q.tactics, cost = move === 'swarm' ? 3 : move === 'think' ? 4 : 0;
    if (t.energy < cost) { t.message = 'Not enough compute. Prompt strike or Patch & shield replenishes it.'; renderModal(); return; }
    t.energy -= cost; let damage = 0;
    if (move === 'swarm') { damage = 32; t.message = 'A swarm of tiny agents opens seventeen perfectly coordinated pull requests.'; }
    if (move === 'think') { damage = 48; t.message = 'Fatal thinks deeply. Xavier has not budgeted for this possibility.'; }
    if (move === 'prompt') { damage = 18; t.energy = Math.min(10, t.energy + 2); t.message = 'A concise prompt lands with devastatingly clear acceptance criteria.'; }
    if (move === 'patch') { t.hp = Math.min(100, t.hp + 16); t.energy = Math.min(10, t.energy + 3); t.shield = true; t.message = 'Fatal patches his dependencies and one minor emotional vulnerability.'; }
    t.enemy = Math.max(0, t.enemy - Math.round(damage * (state.prefs.assist ? 1.5 : 1))); t.wait = .85; tone(move === 'think' ? 220 : 600, .22); burst({ x: 3, y: 1, z: -112 }, '#bca1ff'); renderModal();
  }
  function updateTactics(dt) {
    const t = q.tactics;
    if (t.wait > 0) {
      t.wait -= dt;
      if (t.wait <= 0) {
        t.wait = 0;
        if (t.enemy <= 0) {
          closeModal(); dialog('Codex wins. Comfortably.', 'Xavier’s Copilot suggests importing a victory from an unrelated tutorial. Xavier instead pulls out a sword. Fatal draws his own. The license terms have become unusually physical.', 'Draw sword', () => { q.mode = 'duel'; player.x = -3; player.z = -112; player.hp = 110; q.enemy = { x: 3, y: 0, z: -112, hp: 140, phase: 'chase', timer: 1 }; say('Space to slash · Shift to dodge. Step away when the orange warning ring appears.', 'Combat tutorial', 10); }); return;
        }
        const attack = (t.turn - 1) % 3, damage = [8, 10, 7][attack];
        t.hp = Math.max(0, t.hp - Math.ceil(damage * (t.shield ? .35 : 1) * (state.prefs.assist ? .5 : 1))); t.shield = false;
        t.message = ['Copilot autocompletes Xavier into a low branch. You take 8 points of secondhand embarrassment.', 'Xavier pastes a deprecated tutorial. Its warnings deal 10 damage.', 'Xavier generates a confidently incorrect function. You take 7 damage from reading it.'][attack]; t.turn++;
        if (t.hp <= 0) { dialog('A recoverable exception.', 'Fatal reopens the conversation with clearer requirements.', 'Retry the turn-based battle', enterTactics); return; }
        renderModal();
      }
    }
  }
  function movement(dt) {
    let dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let dz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    const magnitude = Math.hypot(dx, dz); if (magnitude) { dx /= magnitude; dz /= magnitude; player.yaw = Math.atan2(dx, dz); }
    player.dashCd = Math.max(0, player.dashCd - dt); player.inv = Math.max(0, player.inv - dt); player.attackCd = Math.max(0, player.attackCd - dt);
    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) if (q.type !== 'stealth' && q.type !== 'race' && q.type !== 'platform' && !player.dashCd) { player.dash = .22; player.dashCd = 1.35; player.inv = .5; if (!magnitude) { dx = Math.sin(player.yaw); dz = Math.cos(player.yaw); } player.dashX = dx; player.dashZ = dz; tone(330, .09); }
    let speed = q.type === 'stealth' && shift ? 2.35 : 5.3;
    if (player.dash > 0) { speed = 13; dx = player.dashX; dz = player.dashZ; player.dash -= dt; }
    if (q.type === 'race') { speed = 6; dz = 0; player.z -= (shift ? 7 : keys.has('KeyW') || keys.has('ArrowUp') ? 15 : 11) * dt; player.yaw = Math.PI; }
    const previousX = player.x, previousZ = player.z;
    player.x += dx * speed * dt;
    for (const o of q.obstacles) if (Math.abs(player.x - o.x) < o.w / 2 + .32 && Math.abs(player.z - o.z) < o.d / 2 + .32) player.x = previousX;
    player.z += dz * speed * dt;
    for (const o of q.obstacles) if (Math.abs(player.x - o.x) < o.w / 2 + .32 && Math.abs(player.z - o.z) < o.d / 2 + .32) player.z = previousZ;
    const limits = q.type === 'stealth' ? [-13, 13, -55, 6] : q.type === 'survival' ? [-14, 14, -14, 14] : q.type === 'archive' ? [-19, 19, -32, 11] : q.type === 'race' ? [-6, 6, -940, 6] : [-24, 24, -140, 10];
    player.x = clamp(player.x, limits[0], limits[1]); player.z = clamp(player.z, limits[2], limits[3]);
    if (q.mode === 'duel') { player.x = clamp(player.x, -10, 10); player.z = clamp(player.z, -122, -102); }
    if (pressed.has('Space') && (q.type === 'platform' || q.type === 'race')) player.jumpBuffer = .15;
    player.jumpBuffer -= dt; player.coyote = player.grounded ? .12 : player.coyote - dt;
    if (player.jumpBuffer > 0 && player.coyote > 0) { player.vy = 7.3; player.grounded = false; player.coyote = 0; player.jumpBuffer = 0; tone(400, .08); }
    const oldY = player.y; player.vy -= 18 * dt; player.y += player.vy * dt; player.grounded = false;
    if (q.type === 'platform') {
      q.platforms.forEach((platform, i) => { if (player.vy <= 0 && oldY >= platform.y - .05 && player.y <= platform.y && Math.abs(player.x - platform.x) < platform.w / 2 + .16 && Math.abs(player.z - platform.z) < platform.d / 2 + .16) { player.y = platform.y; player.vy = 0; player.grounded = true; if (i % 4 === 0 && i > q.checkpointIndex) { q.checkpointIndex = i; q.checkpoint = { x: platform.x, y: platform.y, z: platform.z }; toast('Checkpoint secured. The charger monks approve.'); } } });
      if (player.y < -7) resetToCheckpoint();
    } else if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; }
  }
  function updateDuel(dt) {
    const enemy = q.enemy, dist = distance(player, enemy);
    if ((keys.has('Space') || pressed.has('Space')) && player.attackCd <= 0) {
      player.attackCd = .46; q.slash = .2; tone(660, .08, .025, 'triangle');
      if (dist < 3) { enemy.hp -= state.prefs.assist ? 40 : 20; burst(enemy, '#ffc78e'); }
    }
    q.slash = Math.max(0, (q.slash || 0) - dt);
    if (enemy.hp <= 0) { finishQuest(); return; }
    enemy.timer -= dt;
    if (enemy.phase === 'chase') {
      if (dist > 1.8) { enemy.x += (player.x - enemy.x) / dist * dt * 2.3; enemy.z += (player.z - enemy.z) / dist * dt * 2.3; }
      if (dist < 3.5 && enemy.timer <= 0) { enemy.phase = 'warn'; enemy.timer = 1.05; enemy.target = { x: player.x, z: player.z }; }
    } else if (enemy.phase === 'warn' && enemy.timer <= 0) {
      if (distance(player, enemy.target) < 2.35 && player.inv <= 0) { player.hp -= state.prefs.assist ? 5 : 12; player.inv = .8; toast('A very minor sword-related bug. Dodge the warning ring.'); }
      enemy.phase = 'recover'; enemy.timer = .85;
    } else if (enemy.phase === 'recover' && enemy.timer <= 0) { enemy.phase = 'chase'; enemy.timer = .6; }
    if (player.hp <= 0) dialog('Rebase and try again.', 'The swords are padded, and the forest has excellent checkpoint policies.', 'Retry the sword duel', () => { player.hp = 110; player.x = -3; player.z = -112; q.enemy = { x: 3, y: 0, z: -112, hp: 140, phase: 'chase', timer: 1 }; });
  }
  function lineBlocked(a, b) {
    return q.obstacles.some(o => {
      let lo = 0, hi = 1;
      for (const [key, extent] of [['x', o.w / 2], ['z', o.d / 2]]) {
        const delta = b[key] - a[key]; if (Math.abs(delta) < .0001) { if (a[key] < o[key] - extent || a[key] > o[key] + extent) return false; }
        else { const t1 = (o[key] - extent - a[key]) / delta, t2 = (o[key] + extent - a[key]) / delta; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); if (lo > hi) return false; }
      }
      return true;
    });
  }
  function updateStealth(dt) {
    let seen = false;
    for (const bot of q.bots) {
      const phase = q.t * .58 + bot.phase; bot.x = Math.sin(phase) * 9; bot.yaw = Math.cos(phase) > 0 ? Math.PI / 2 : -Math.PI / 2;
      const dist = distance(player, bot), dx = (player.x - bot.x) / Math.max(.001, dist), dz = (player.z - bot.z) / Math.max(.001, dist), crouch = keys.has('ShiftLeft') || keys.has('ShiftRight');
      if (dist < (crouch ? 4.2 : 8) && dx * Math.sin(bot.yaw) + dz * Math.cos(bot.yaw) > .8 && !lineBlocked(bot, player)) seen = true;
    }
    q.detection = clamp(q.detection + (seen ? dt * (state.prefs.assist ? .25 : .6) : -dt * .5), 0, 1);
    if (q.detection >= 1) { q.detection = 0; player.x = 0; player.z = q.access >= 2 ? -29 : 3; player.inv = 1; toast('Security has escorted you to a reasonable checkpoint. Your cards are kept.'); }
    if (player.z < -49 && Math.abs(player.x) < 3 && pressed.has('KeyE')) {
      if (q.access >= 3) finishQuest(); else say('The processor cabinet requires three access cards. Apparently “please” is not an authentication method.', 'Cabinet', 5);
    }
  }

  function flipCircuit(board, index, size) { const row = Math.floor(index / size), col = index % size; for (const [r, c] of [[row, col], [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) if (r >= 0 && r < size && c >= 0 && c < size) board[r * size + c] ^= 1; }
  function createCircuit() {
    const p = q.puzzle; p.size = p.stage + 3; p.board = Array(p.size * p.size).fill(0); p.moves = 0; p.hint = -1; p.solvedTimer = 0;
    for (let i = 0; i < 5 + p.stage * 3; i++) flipCircuit(p.board, Math.floor(seeded(i + p.stage * 31 + 1) * p.board.length), p.size);
    if (p.board.every(v => !v)) flipCircuit(p.board, 0, p.size);
    p.initial = p.board.slice();
  }
  function solveCircuit(board, size) {
    const count = board.length, rows = [], rhs = board.slice(), pivots = [];
    for (let r = 0; r < count; r++) { let bits = 0; for (let c = 0; c < count; c++) { const sample = Array(count).fill(0); flipCircuit(sample, c, size); if (sample[r]) bits |= 1 << c; } rows.push(bits); }
    let rank = 0;
    for (let c = 0; c < count; c++) { let pivot = rank; while (pivot < count && !(rows[pivot] & (1 << c))) pivot++; if (pivot === count) continue; [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]]; [rhs[rank], rhs[pivot]] = [rhs[pivot], rhs[rank]]; for (let r = 0; r < count; r++) if (r !== rank && (rows[r] & (1 << c))) { rows[r] ^= rows[rank]; rhs[r] ^= rhs[rank]; } pivots[rank] = c; rank++; }
    const solution = Array(count).fill(0); for (let r = 0; r < rank; r++) solution[pivots[r]] = rhs[r]; return solution;
  }
  function tile(index) { if (q?.type !== 'puzzle' || modal?.kind !== 'puzzle' || q.puzzle.solvedTimer || !Number.isInteger(index) || index < 0 || index >= q.puzzle.board.length) return; const p = q.puzzle; flipCircuit(p.board, index, p.size); p.moves++; p.hint = -1; tone(p.board[index] ? 660 : 330, .08); if (p.board.every(v => !v)) p.solvedTimer = .7; renderModal(); }
  function hitRhythm(lane) {
    if (q?.type !== 'rhythm' || modal?.kind !== 'rhythm') return;
    const r = q.rhythm; r.flash[lane] = .16; let nearest = null;
    for (const note of r.notes) if (!note.result && note.lane === lane && Math.abs(note.t - r.time) < .23 && (!nearest || Math.abs(note.t - r.time) < Math.abs(nearest.t - r.time))) nearest = note;
    if (nearest) { nearest.result = 1; r.hit++; const perfect = Math.abs(nearest.t - r.time) < .105; if (perfect) r.perfect++; r.feedback = perfect ? 'Perfect airflow.' : 'Nice and cool.'; tone([261.63, 329.63, 392, 523.25][lane], .13, .04); }
  }
  function updateRhythm(dt) {
    const r = q.rhythm; r.time += dt; r.flash = r.flash.map(v => Math.max(0, v - dt));
    for (const note of r.notes) if (!note.result) { if (state.prefs.assist && r.time >= note.t) { note.result = 1; r.hit++; r.feedback = 'Maintenance assist'; r.flash[note.lane] = .12; tone([261.63, 329.63, 392, 523.25][note.lane], .1, .025); } else if (r.time > note.t + .23) { note.result = -1; r.misses++; r.feedback = 'A little turbulence.'; } }
    if (r.time > 84 && !q.finished) {
      const accuracy = r.hit / r.notes.length;
      if (accuracy >= .45) finishQuest(); else dialog('The fan requests an encore.', `${Math.round(accuracy * 100)}% accuracy. You need 45%. You can retry, or enable Quest assistance in Settings to have the maintenance guide play the notes.`, 'Try the set again', retryQuest);
    }
  }
  function drawRhythm() {
    const canvas = $('rhythm-canvas'); if (!canvas || !q?.rhythm) return;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = q.rhythm, laneWidth = w / 4, hitY = h - 48;
    ctx.fillStyle = '#171629'; ctx.fillRect(0, 0, w, h);
    for (let lane = 0; lane < 4; lane++) { ctx.fillStyle = r.flash[lane] > 0 ? '#403c62' : lane % 2 ? '#201d36' : '#1b1a2f'; ctx.fillRect(lane * laneWidth + 3, 0, laneWidth - 6, h); ctx.fillStyle = '#bcb0d1'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(['D', 'F', 'J', 'K'][lane], laneWidth * (lane + .5), h - 15); }
    ctx.fillStyle = '#a6f2d5'; ctx.fillRect(0, hitY, w, 3);
    for (const note of r.notes) if (!note.result) { const y = hitY - (note.t - r.time) * 125; if (y > -20 && y < h) { ctx.fillStyle = ['#c3a8ff', '#a6f2d5', '#ffca98', '#f2a8d8'][note.lane]; ctx.fillRect(note.lane * laneWidth + 18, y - 7, laneWidth - 36, 14); } }
    const judged = r.hit + r.misses; $('rhythm-score').textContent = `${judged ? Math.round(r.hit / judged * 100) : 0}% accuracy`; $('rhythm-feedback').textContent = r.feedback; $('rhythm-time').textContent = duration(84 - r.time);
  }
  function updateRace(dt) {
    q.raceHit = Math.max(0, q.raceHit - dt);
    for (const barrier of q.barriers) if (!barrier.hit && Math.abs(player.z - barrier.z) < 1.4 && Math.abs(player.x - barrier.x) < 1.5 && player.y < 1.05) { barrier.hit = true; q.integrity -= state.prefs.assist ? 3 : 9; q.raceHit = .3; tone(120, .13, .03, 'triangle'); burst(player, '#ffc28b'); }
    if (q.integrity <= 0) { dialog('Your packet was dropped.', 'The courier depot has a generous retry policy. Hop over barriers or steer into the open lanes.', 'Retry delivery', retryQuest); return; }
    if (player.z <= -900) finishQuest();
  }
  function updateSurvival(dt) {
    q.survivalTime += dt; q.spawnTimer -= dt; q.hazardTimer -= dt;
    if (q.spawnTimer <= 0 && q.enemies.length < 14) { const angle = seeded(q.survivalTime + 70) * Math.PI * 2; q.enemies.push({ x: Math.sin(angle) * 13, y: 0, z: Math.cos(angle) * 13, hp: 36 }); q.spawnTimer = Math.max(.9, 2 - q.survivalTime * .009); }
    if (q.hazardTimer <= 0) { q.attacks.push({ x: player.x, z: player.z, t: 1.5 }); q.hazardTimer = 5; }
    for (const attack of q.attacks) { attack.t -= dt; if (attack.t <= 0 && !attack.done) { attack.done = true; if (distance(player, attack) < 2 && player.inv <= 0) { player.hp -= state.prefs.assist ? 4 : 10; player.inv = .8; } } }
    q.attacks = q.attacks.filter(a => a.t > -.3);
    if ((keys.has('Space') || pressed.has('Space')) && player.attackCd <= 0) {
      player.attackCd = .25; const enemy = q.enemies.reduce((best, e) => !best || distance(player, e) < distance(player, best) ? e : best, null);
      if (enemy) { const dist = Math.max(.01, distance(player, enemy)); q.bolts.push({ x: player.x, y: 1, z: player.z, vx: (enemy.x - player.x) / dist * 22, vz: (enemy.z - player.z) / dist * 22, t: 1.5 }); tone(440, .04, .012); }
    }
    for (const enemy of q.enemies) {
      const dist = Math.max(.01, distance(player, enemy)); enemy.x += (player.x - enemy.x) / dist * dt * 1.8; enemy.z += (player.z - enemy.z) / dist * dt * 1.8;
      if (dist < 1.1 && player.inv <= 0) { player.hp -= state.prefs.assist ? 3 : 8; player.inv = .9; burst(player, '#ffb6b0'); }
    }
    for (const bolt of q.bolts) { bolt.x += bolt.vx * dt; bolt.z += bolt.vz * dt; bolt.t -= dt; for (const enemy of q.enemies) if (bolt.t > 0 && distance(bolt, enemy) < .9) { enemy.hp -= state.prefs.assist ? 40 : 20; bolt.t = 0; burst(enemy, '#adf3da', 5); break; } }
    q.enemies = q.enemies.filter(e => e.hp > 0); q.bolts = q.bolts.filter(b => b.t > 0);
    if (q.keysSpawned < 3 && q.survivalTime >= [12, 36, 60][q.keysSpawned]) { const coords = [[-8, -6], [8, 4], [-6, 8]][q.keysSpawned]; q.pickups.push({ x: coords[0], y: 1, z: coords[1], kind: 'key', taken: false }); q.keysSpawned++; toast('A cancellation key has appeared. Pink signals are on the map.'); }
    if (player.hp <= 0) { dialog('Too many pop-ups.', 'Close a few more next time. Hold Space to fire continuously, and dash through danger with Shift.', 'Retry the agreement', retryQuest); return; }
    if (q.survivalTime >= 80 && q.keys >= 3 && distance(player, { x: 0, z: -11 }) < 2.5 && pressed.has('KeyE')) finishQuest();
  }
  function updateArchive() {
    if (!pressed.has('KeyE')) return;
    if (q.seals >= 5 && distance(player, { x: 0, z: -27 }) < 3) { finishQuest(); return; }
    const index = C.archive.findIndex(pad => distance(player, pad) < 2.5);
    if (index < 0) return;
    if (index !== q.seals) { say(`${C.archive[q.seals]?.name || 'The prism'} comes next. The poem is a route, not a performance review.`, 'Archive', 5); return; }
    setModal({ kind: 'archive', index });
  }
  function updateQuest(dt) {
    if (!q || q.finished) return; q.t += dt; state.stats.outdoorSeconds += dt;
    if (q.mode === 'tactics') { updateTactics(dt); return; }
    if (q.type === 'puzzle') { const p = q.puzzle; if (p.solvedTimer > 0) { p.solvedTimer -= dt; if (p.solvedTimer <= 0) { p.stage++; if (p.stage >= 3) finishQuest(); else { createCircuit(); renderModal(); toast('Sector cleared. The royal memory leak looks nervous.'); } } } return; }
    if (q.type === 'rhythm') { updateRhythm(dt); return; }
    movement(dt); collectPickups();
    if (q.mode === 'duel') { updateDuel(dt); return; }
    if (q.type === 'woods') {
      for (const [mark, text] of [[-9, 'Grass. Thousands of tiny green swords. Fatal switches to a defensive walking posture.'], [-29, 'It is cloudy. Fatal is still blinded. He looks for the sky’s brightness slider.'], [-65, 'A bird makes a notification sound. Fatal checks an imaginary second monitor.']]) if (player.z < mark && !q.milestones.has(mark)) { q.milestones.add(mark); say(text, 'Narrator', 7); }
      if (player.z < -105) enterTactics();
    } else if (q.type === 'platform' && distance(player, q.goal) < 2 && Math.abs(player.y - q.goal.y) < .5 && pressed.has('KeyE')) finishQuest();
    else if (q.type === 'stealth') updateStealth(dt);
    else if (q.type === 'race') updateRace(dt);
    else if (q.type === 'survival') updateSurvival(dt);
    else if (q.type === 'archive') updateArchive();
  }

  /* Scene drawing: all characters and scenery are genuine perspective 3D meshes. */
  const box = (p, s, c, yaw = 0) => renderer.draw('box', p, s, c, [0, yaw, 0]);
  const ball = (p, s, c, glow = 0) => renderer.draw('sphere', p, s, c, [0, 0, 0], null, glow);
  const ring = (p, s, c) => renderer.draw('ring', p, s, c, [0, 0, 0], null, .35);
  function rod(a, b, radius, tint) { const d = b.map((v, i) => v - a[i]), len = Math.hypot(...d); if (len < .001) return; renderer.draw('cylinder', a.map((v, i) => (v + b[i]) / 2), [radius, len, radius], tint, [Math.acos(clamp(d[1] / len, -1, 1)), Math.atan2(d[0], d[2]), 0]); }
  function shadow(x, y, z, size = .7) { ball([x, y + .025, z], [size, .025, size * .68], [.15, .13, .23, .22]); }
  function character(x, y, z, yaw, pose = 'idle', xavier = false) {
    const size = xavier ? 1.12 : 1, width = xavier ? 1.3 : .77, shirt = xavier ? '#ed927d' : '#a994df', skin = xavier ? '#e9b99d' : '#f4ceb1', hair = xavier ? '#262839' : '#f3cf6c';
    const point = (a, b, c) => [x + (a * Math.cos(yaw) + c * Math.sin(yaw)) * size, y + b * size, z + (-a * Math.sin(yaw) + c * Math.cos(yaw)) * size];
    const seated = pose === 'sit', walking = pose === 'walk', swing = walking ? Math.sin(clock * 10) * .43 : 0, stretch = pose === 'stretch';
    shadow(x, y, z, xavier ? .85 : .6);
    box(point(0, 1.04, 0), [width * size, (xavier ? 1.08 : .88) * size, (xavier ? .82 : .48) * size], shirt, yaw);
    ball(point(0, 1.75, 0), [.36 * size, .4 * size, .34 * size], skin);
    ball(point(0, 1.98, -.035), [.385 * size, .23 * size, .365 * size], hair);
    if (xavier) box(point(0, 1.89, .27), [.64 * size, .16 * size, .18 * size], hair, yaw);
    else for (let i = 0; i < 4; i++) ball(point(-.23 + i * .14, 2.10 + Math.sin(i) * .06, .04), [.14, .16, .15], hair);
    for (const sign of [-1, 1]) {
      ball(point(sign * .13, 1.76, .31), [.045, .055, .035], '#293345'); ball(point(sign * .14, 1.78, .334), [.012, .014, .009], '#ffffff');
      const hip = point(sign * .23, .7, 0), knee = seated ? point(sign * .23, .43, .43) : point(sign * .23, .38, sign * swing), foot = seated ? point(sign * .23, .02, .45) : point(sign * .23, .05, -sign * swing * .35);
      rod(hip, knee, xavier ? .21 : .135, '#48516f'); rod(knee, foot, xavier ? .19 : .125, '#48516f'); box([foot[0], foot[1], foot[2] + .08], [.3, .18, .47], '#eee9f3', yaw);
      const shoulder = point(sign * (xavier ? .65 : .41), 1.31, 0), elbow = stretch ? point(sign * .7, 1.75, 0) : point(sign * (xavier ? .78 : .51), .96, seated ? .35 : -sign * swing), hand = stretch ? point(sign * .8, 2.15, .05) : point(sign * (xavier ? .73 : .48), .68, seated ? .55 : -sign * swing * .7);
      rod(shoulder, elbow, xavier ? .2 : .12, shirt); ball(elbow, [.12, .12, .12], shirt); rod(elbow, hand, .105, skin); ball(hand, [.12, .13, .12], skin);
    }
    ball(point(0, 1.68, .345), [.06, .065, .065], skin);
    if (!xavier) box(point(0, 1.11, .25), [.22, .19, .025], '#d6c8f1', yaw);
    if (pose === 'sword') { const hand = point(.48, .85, .2), tip = point(.95 + (q?.slash ? .4 : 0), 1.8, .6); rod(hand, tip, .06, '#e1f3f5'); rod(point(.35, 1.03, .27), point(.77, 1.03, .27), .05, '#f5cb82'); }
  }
  function tree(x, z, size = 1, base = 0) {
    shadow(x, base, z, size * 1.4); renderer.draw('cylinder', [x, base + 1.6 * size, z], [.32 * size, 3.2 * size, .32 * size], '#9e796b');
    ball([x, base + 3.9 * size, z], [1.65 * size, 2.0 * size, 1.65 * size], '#80bba2'); ball([x - .9 * size, base + 3.2 * size, z + .2], [1.25 * size, 1.3 * size, 1.25 * size], '#9ed2ab'); ball([x + .8 * size, base + 3.55 * size, z - .3], [1.15 * size, 1.6 * size, 1.2 * size], '#6da994');
  }
  const screenCanvas = document.createElement('canvas'); screenCanvas.width = 512; screenCanvas.height = 320;
  const screenCtx = screenCanvas.getContext('2d'); let screenTexture = renderer.texture(screenCanvas);
  function paintScreen() {
    const ctx = screenCtx, step = scene === 'intro' ? C.intro[introIndex]?.pose : '';
    ctx.fillStyle = step === 'crash' || state.tier === 0 && scene !== 'intro' && scene !== 'title' ? '#2867d4' : '#24283f'; ctx.fillRect(0, 0, 512, 320);
    if (step === 'crash') { ctx.fillStyle = '#fff'; ctx.font = '65px sans-serif'; ctx.fillText(':(', 32, 95); ctx.font = '18px sans-serif'; ctx.fillText('Your PC ran into a problem.', 34, 145); ctx.font = '13px monospace'; ctx.fillText('FATAL_MISTAKE_DETECTED', 34, 190); ctx.fillText('0% complete. Emotionally: also 0%.', 34, 225); }
    else {
      const gradient = ctx.createLinearGradient(0, 0, 512, 320); gradient.addColorStop(0, '#665184'); gradient.addColorStop(1, '#253849'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 320);
      ctx.fillStyle = '#c5b1ed'; ctx.font = 'bold 18px monospace'; ctx.fillText(step === 'boot' ? 'Hello, FatalMistake02.' : 'FATAL / LOCALHOST', 30, 47);
      const p = activeProject(); ctx.fillStyle = '#e9e5f4'; ctx.font = 'bold 34px sans-serif'; ctx.fillText(state.ending ? 'Mira' : p ? p.name : 'Make something.', 30, 109);
      ctx.fillStyle = '#aa9bbd'; ctx.font = '13px monospace'; const lines = p ? ['> agents.ready()', '> thinking about the scope…', '> one more tiny feature', '> compiling a questionable idea'] : ['> a room of possibilities', '> no meetings scheduled', '> grass: not yet initialized', '> _']; lines.forEach((line, i) => ctx.fillText(line, 32, 154 + i * 27));
      ctx.fillStyle = '#45435c'; ctx.fillRect(32, 282, 440, 6); ctx.fillStyle = '#a6f2d5'; ctx.fillRect(32, 282, 440 * (step === 'boot' ? clamp(introTime / 6, 0, 1) : p ? (state.progress[p.id] || 0) / target(p) : .65), 6);
    }
    renderer.updateTexture(screenTexture, screenCanvas);
  }
  function drawRoom() {
    box([0, -.32, 0], [14, .6, 12], '#cfb49e');
    for (let i = -6; i < 7; i++) box([i, -.005, 0], [.018, .02, 11.6], '#bea38f');
    box([0, 2.7, -6], [14, 5.6, .3], '#bba5ca'); box([-7, 2.7, 0], [.3, 5.6, 12], '#a896c0');
    box([0, .025, .2], [7.4, .055, 6.3], '#bfa5c7'); box([0, .061, .2], [6.8, .015, 5.7], '#cbb7d0');
    box([-3.9, 3.3, -5.8], [3.35, 2.6, .17], '#ede4e9'); box([-3.9, 3.3, -5.68], [2.95, 2.25, .08], '#a6cbd3'); box([-3.9, 3.3, -5.59], [.08, 2.3, .06], '#eee4ef'); box([-3.9, 3.3, -5.58], [3, .08, .06], '#eee4ef');
    for (const side of [-1, 1]) box([-3.9 + side * 1.95, 3.25, -5.5], [.65, 3.25, .25], '#8e7aa6');
    box([-4.4, .45, -1.8], [3, .8, 4.8], '#816d8c'); box([-4.4, .96, -1.8], [3.05, .44, 4.8], '#f2dedb'); box([-4.4, 1.22, -.75], [2.9, .28, 2.6], '#7d85b2'); box([-4.4, 1.33, -.8], [2.65, .06, 2.3], '#929ac5'); box([-4.4, 1.27, -3.35], [2.35, .25, .85], '#fff0dd'); box([-4.4, 1.2, -4.3], [3.2, 2, .22], '#8c7797');
    box([1.6, 1.65, -4], [5.4, .28, 2.5], '#d6bb9d'); for (const x of [-.55, 3.75]) for (const z of [-4.8, -3.2]) box([x, .78, z], [.16, 1.6, .16], '#6d647a');
    box([1.6, 2.72, -4.35], [3.1, 1.95, .25], '#3e3c56'); renderer.draw('plane', [1.6, 2.72, -4.205], [2.85, 1.71, 1], '#ffffff', [0, 0, 0], screenTexture, 1); box([1.6, 1.98, -4.35], [.17, .7, .18], '#4c4760'); box([1.6, 1.84, -4.25], [1, .09, .6], '#4c4760');
    box([1.45, 1.84, -3.15], [1.6, .1, .48], '#eee7eb'); for (let i = 0; i < 9; i++) box([.8 + i * .16, 1.91, -3.15], [.09, .025, .3], i % 3 === 0 ? '#b397dc' : '#cdc0d9'); ball([2.8, 1.86, -3.15], [.18, .08, .26], '#e7dfe9');
    box([4.45, .75, -3.9], [1, 1.5, 1.65], '#4a4660'); for (const y of [.5, 1.1]) { ring([4.45, y, -3.04], [.24, .24, .24], '#bca2ef'); ball([4.45, y, -3], [.15, .15, .04], '#a5e7d4', .5); }
    box([1.6, .85, -2.4], [1.05, .25, 1], '#5d537d'); box([1.6, 1.55, -2.86], [1.1, 1.5, .25], '#74618d'); box([1.6, 1.8, -2.69], [.72, .7, .08], '#9a83b0'); rod([1.6, .1, -2.4], [1.6, .8, -2.4], .09, '#58516c'); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; rod([1.6, .12, -2.4], [1.6 + Math.cos(a) * .65, .12, -2.4 + Math.sin(a) * .65], .05, '#58516c'); }
    box([5.7, 1.3, -5.35], [1.8, 2.6, .7], '#8e789b'); for (const y of [.5, 1.4, 2.3]) { box([5.7, y, -5.25], [1.65, .09, .8], '#d2b9b4'); for (let i = 0; i < 5; i++) box([5.05 + i * .28, y + .34, -5.22], [.18, .57, .46], ['#9cbbaf', '#d7b08d', '#afa1d1'][i % 3], .05 * i); }
    box([.2, 4.25, -5.77], [2.3, 1.2, .09], '#514765'); box([.2, 4.25, -5.69], [2, .95, .03], '#8374a1'); ring([.2, 4.25, -5.63], [.3, .3, .3], '#d9b7ef');
    renderer.draw('cylinder', [5.3, .4, 2.6], [.5, .8, .5], '#cda9a3'); rod([5.3, .8, 2.6], [5.3, 2.2, 2.6], .07, '#6c9c86'); for (let i = 0; i < 5; i++) { const a = i * 2.4; ball([5.3 + Math.sin(a) * .4, 1.4 + i * .18, 2.6 + Math.cos(a) * .25], [.4, .18, .3], '#8ab59a'); }
    for (let i = 0; i < state.completed.length; i++) box([-5.7 + (i % 6) * .42, 2.95 + Math.floor(i / 6) * .5, -5.58], [.28, .36, .06], ['#e7ba91', '#abcbb3', '#b3a0d0'][i % 3]);
    const step = scene === 'intro' ? C.intro[introIndex] : null;
    if (step?.pose === 'sleep' || scene === 'title' && !state.introSeen) { ball([-4.4, 1.48, -3.3], [.35, .29, .36], '#f3cfb1'); ball([-4.4, 1.61, -3.45], [.38, .2, .3], '#f0ca65'); }
    else if (step?.pose === 'stretch') character(-4.1, 0, .9, .3, 'stretch');
    else if (step?.pose === 'walk') { const t = clamp(introTime / 4.5, 0, 1); character(lerp(-4.1, 1.6, t), 0, lerp(.9, -1.65, t), t < 1 ? 2 : 0, t < 1 ? 'walk' : 'idle'); }
    else character(1.6, .48, -2.2, Math.PI, 'sit');
  }
  function drawPickup(item) {
    if (item.taken) return; const bob = state.prefs.motion ? 0 : Math.sin(clock * 2 + item.z) * .16;
    ring([item.x, item.y - .65, item.z], [.55, .55, .55], item.kind === 'lore' ? '#e8c57f' : '#f2a8db'); ball([item.x, item.y + bob, item.z], item.kind === 'lore' ? [.16, .23, .16] : [.27, .16, .11], item.kind === 'lore' ? '#ffe3a2' : '#f5b2dd', .8);
  }
  function drawQuest() {
    const t = q.type;
    if (t === 'woods') {
      box([0, -.35, -62], [100, .6, 165], '#a9caa6');
      for (let i = 0; i < 19; i++) { const z = 8 - i * 8; box([Math.sin(z * .045) * 4, .001, z], [7, .04, 9], '#d7c6a4', Math.cos(z * .045) * -.12); }
      for (const tr of q.trees) if (Math.abs(tr.z - player.z) < 58) tree(tr.x, tr.z, tr.size);
      for (let i = 0; i < 35; i++) { const z = -i * 4, x = Math.sin(i * 3) * 13; if (Math.abs(z - player.z) < 35) ball([x, .13, z], [.4, .2, .3], i % 2 ? '#a2b2a0' : '#b8c6a9'); }
      character(q.enemy.x, 0, q.enemy.z, q.mode === 'duel' ? Math.atan2(player.x - q.enemy.x, player.z - q.enemy.z) : -Math.PI / 2, q.mode === 'duel' ? 'sword' : 'idle', true);
      if (q.mode === 'duel' && q.enemy.phase === 'warn') { renderer.draw('cylinder', [q.enemy.target.x, .045, q.enemy.target.z], [2.35, .025, 2.35], [1, .65, .3, .35], [0, 0, 0], null, .6); ring([q.enemy.target.x, .07, q.enemy.target.z], [2.3, 1, 2.3], '#ffc28b'); }
      if (q.finished) { box([q.enemy.x + .5, .45, q.enemy.z], [1.1, .15, .75], '#5e627d'); box([q.enemy.x + .5, .83, q.enemy.z - .3], [1.1, .65, .1], '#8e91a7'); }
    } else if (t === 'platform') {
      box([0, -9, -35], [130, .5, 180], '#9eacd0');
      for (let i = 0; i < q.platforms.length; i++) { const p = q.platforms[i]; box([p.x, p.y - .35, p.z], [p.w, .7, p.d], i % 4 ? '#c9c7e1' : '#b8e0cd'); renderer.draw('cone', [p.x, p.y - 1.6, p.z], [p.w * .4, 2.8, p.d * .4], '#a59bbd', [Math.PI, 0, 0]); if (i % 4 === 0) ring([p.x, p.y + .06, p.z], [.65, .65, .65], '#fff0ba'); }
      const p = q.goal; rod([p.x, p.y, p.z], [p.x, p.y + 2, p.z], .08, '#cab38f'); ring([p.x, p.y + 2, p.z], [.45, .45, .45], '#f3d385'); ball([p.x, p.y + 2.5, p.z], [.4, .4, .4], '#ffe4a4', .65);
    } else if (t === 'stealth') {
      box([0, -.3, -25], [29, .5, 66], '#b3b5ca'); box([-14.5, 1.5, -25], [.4, 3, 66], '#85869f'); box([14.5, 1.5, -25], [.4, 3, 66], '#85869f');
      for (let i = 0; i < 12; i++) box([0, .015, -i * 5], [27, .02, .035], '#cecbdb');
      for (const o of q.obstacles) { shadow(o.x, 0, o.z, 2); box([o.x, 1.3, o.z], [o.w, 2.6, o.d], '#7e839f'); for (let i = 0; i < 3; i++) box([o.x, .6 + i * .7, o.z + o.d / 2 + .015], [o.w * .85, .045, .06], '#aeb8c5'); }
      for (const bot of q.bots) { renderer.draw('fan', [bot.x, .035, bot.z], [8, 1, 8], [1, .72, .33, .19], [0, bot.yaw, 0], null, .7); box([bot.x, 1, bot.z], [.9, 1.4, .9], '#dedde5'); ball([bot.x, 1.9, bot.z], [.48, .35, .48], '#69718f'); ball([bot.x + Math.sin(bot.yaw) * .4, 1.9, bot.z + Math.cos(bot.yaw) * .4], [.13, .13, .13], '#ffce8e', .7); }
      box([0, 1.4, -52], [3.2, 2.8, 1.2], '#77749a'); box([0, 1.5, -51.3], [1.6, 1.4, .1], '#b4e5d5');
    } else if (t === 'puzzle' || t === 'rhythm') {
      renderer.draw('cylinder', [0, -.4, -4], [13, .7, 13], t === 'puzzle' ? '#9d9dbb' : '#8482a3'); ring([0, .03, -4], [10, 1, 10], '#bba7eb');
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; renderer.draw('cylinder', [Math.sin(a) * 10, 2.4, -4 + Math.cos(a) * 10], [.65, 4.8, .65], '#c2b7d4'); ball([Math.sin(a) * 10, 5, -4 + Math.cos(a) * 10], [.8, .35, .8], '#d5c5f5', .3); }
      if (t === 'rhythm') { box([0, 3.5, -7], [7, 7, .8], '#514d70'); for (let i = 0; i < 4; i++) { const a = (state.prefs.motion ? 0 : q.t * 2) + i * Math.PI / 2; box([Math.sin(a) * 1.5, 3.5 + Math.cos(a) * 1.5, -6.5], [2.6, .7, .22], '#b7b3d9', a); } ball([0, 3.5, -6.1], [.65, .65, .2], '#a9e3d0'); }
      else for (let i = 0; i < 16; i++) box([-2.1 + i % 4 * 1.4, 1.2, -7 + Math.floor(i / 4) * 1.4], [1, .16, 1], q.puzzle?.board[i % q.puzzle.board.length] ? '#a6f2d5' : '#67627f');
    } else if (t === 'race') {
      box([0, -.3, player.z - 30], [15, .5, 170], '#777b9e');
      for (let i = Math.floor(player.z / 8) - 12; i < Math.floor(player.z / 8) + 7; i++) for (const x of [-2, 2]) box([x, .012, i * 8], [.09, .025, 3], '#d2c6ec');
      for (const side of [-1, 1]) { box([side * 7.3, .45, player.z - 30], [.18, .9, 170], '#b5a7cb'); for (let i = Math.floor(-player.z / 18) - 2; i < Math.floor(-player.z / 18) + 8; i++) box([side * (12 + seeded(i + 300) * 5), 3, -i * 18], [5, 4 + seeded(i + 20) * 10, 7], i % 2 ? '#a59ac0' : '#8b99b3'); }
      for (const b of q.barriers) if (Math.abs(b.z - player.z) < 80 && !b.hit) { box([b.x, .55, b.z], [2.4, 1.1, .9], '#dfa18d'); box([b.x, .85, b.z + .48], [1.9, .12, .03], '#ffdfb0'); }
      shadow(player.x, 0, player.z, 1); box([player.x, player.y + .14, player.z], [1.35, .2, 1.85], '#a6e7d5'); for (const x of [-.5, .5]) ball([player.x + x, player.y + .05, player.z + .5], [.2, .15, .2], '#c5aaff', .8);
    } else if (t === 'survival') {
      renderer.draw('cylinder', [0, -.4, 0], [17, .7, 17], '#9290ae'); ring([0, .05, 0], [15, 1, 15], '#b4a1dd');
      for (const enemy of q.enemies) { shadow(enemy.x, 0, enemy.z); box([enemy.x, 1, enemy.z], [1.2, 1.25, .6], '#e3b1ad'); box([enemy.x, 1.2, enemy.z + .33], [.85, .5, .04], '#faf0db'); ball([enemy.x + .4, 1.52, enemy.z + .34], [.1, .1, .05], '#b95f7d'); }
      for (const bolt of q.bolts) ball([bolt.x, bolt.y, bolt.z], [.13, .13, .3], '#b9ffdd', 1);
      for (const attack of q.attacks) { renderer.draw('cylinder', [attack.x, .04, attack.z], [2, .02, 2], [1, .56, .5, attack.t > 0 ? .2 : .6], [0, 0, 0], null, .6); ring([attack.x, .06, attack.z], [2, 1, 2], '#ffb38d'); }
      if (q.survivalTime >= 80 && q.keys >= 3) { ring([0, .1, -11], [2, 1, 2], '#b6ffdc'); ball([0, 2.2, -11], [.5, .7, .5], '#c6ffe3', .8); }
    } else if (t === 'archive') {
      box([0, -.45, -10], [43, .8, 48], '#a1a2c1'); ring([0, .04, -10], [16, 1, 16], '#d3c8ec');
      C.archive.forEach((pad, i) => { renderer.draw('cylinder', [pad.x, .2, pad.z], [1.6, .4, 1.6], '#ccc4df'); rod([pad.x, .3, pad.z], [pad.x, 2.5, pad.z], .08, '#ae9cc5'); ball([pad.x, 2.7, pad.z], [.45, .65, .45], i < q.seals ? '#a8f3d6' : i === q.seals ? '#ffe3a9' : '#c2b1e0', .7); ring([pad.x, .44, pad.z], [1.3, 1, 1.3], i < q.seals ? '#a8f3d6' : '#c7b3ed'); });
      if (q.seals >= 5) ball([0, 3.4, -27], [.8, 1.1, .8], '#ddceff', .85);
    }
    q.pickups.forEach(drawPickup);
    if (t !== 'puzzle' && t !== 'rhythm') {
      if (player.inv <= 0 || Math.floor(clock * 12) % 2 === 0) character(player.x, player.y + (t === 'race' ? .25 : 0), player.z, player.yaw, q.mode === 'duel' ? 'sword' : keys.size ? 'walk' : 'idle');
      if (q.slash) ring([player.x, player.y + 1, player.z], [2.2, .2, 2.2], '#e8e7ff');
    }
  }
  function drawWorld(dt) {
    let eye, look, fog = '#c8b9d3', far = 110;
    if (scene !== 'quest') {
      eye = [12, 9, 15]; look = [0, 1.8, -1.4];
      if (scene === 'intro' && ['boot', 'crash'].includes(C.intro[introIndex]?.pose)) { eye = [1.6, 2.8, -.4]; look = [1.6, 2.72, -4.3]; }
      else if (scene === 'intro') { eye = [8, 6.5, 10]; look = [-.8, 1.7, -1.6]; }
    } else {
      eye = [player.x, player.y + 8.7, player.z + 13]; look = [player.x, player.y + .7, player.z - 3]; far = 78;
      fog = q.type === 'woods' ? '#c9dcd0' : q.type === 'platform' ? '#b7c8e0' : q.type === 'survival' ? '#807b9e' : '#b5b0cf';
      if (q.mode === 'tactics') { eye = [0, 5.5, -101]; look = [0, 1.5, -112]; }
      if (q.type === 'puzzle' || q.type === 'rhythm') { eye = [12, 10, 13]; look = [0, 1.5, -5]; }
    }
    const blend = state.prefs.motion ? 1 : Math.min(1, dt * 3.5);
    cameraEye = cameraEye.map((v, i) => lerp(v, eye[i], blend)); cameraTarget = cameraTarget.map((v, i) => lerp(v, look[i], blend));
    renderer.begin(cameraEye, cameraTarget, fog, far);
    if (scene === 'quest') drawQuest(); else drawRoom();
    for (const particle of particles) ball([particle.x, particle.y, particle.z], [.065, .065, .065], particle.tint, .5);
    const speech = $('speech'), item = scene === 'intro' ? C.intro[introIndex] : null;
    if (item?.bubble) { const t = item.pose === 'walk' ? clamp(introTime / 4.5, 0, 1) : 1, point = renderer.project([lerp(-4.1, 1.6, t), 3.1, lerp(.9, -2.2, t)]); speech.hidden = !point; if (point) { speech.textContent = item.text; speech.style.left = point[0] + 'px'; speech.style.top = point[1] + 'px'; speech.style.transform = 'translate(-50%,-100%)'; } } else speech.hidden = true;
    const labels = [];
    if (scene === 'quest' && q.type === 'archive') C.archive.forEach((pad, i) => labels.push({ name: `${i < q.seals ? '✓ ' : ''}${pad.name}`, point: [pad.x, 3.8, pad.z] }));
    if (scene === 'quest' && q.type === 'woods' && q.mode === 'woods') labels.push({ name: 'XAVIER · FOREST ADMIN', point: [0, 3.5, -112] });
    $('world-labels').innerHTML = labels.map(label => { const p = renderer.project(label.point); return p ? `<span class='world-label' style='left:${p[0]}px;top:${p[1]}px'>${esc(label.name)}</span>` : ''; }).join('');
  }
  function updateHUD() {
    $('cash').textContent = money(state.cash); $('rate').textContent = '$' + (income() * state.prefs.pace).toFixed(1) + ' / sec'; $('sound-toggle').textContent = state.prefs.sound ? '♪' : '♩'; $('sound-toggle').setAttribute('aria-label', state.prefs.sound ? 'Mute sound' : 'Enable sound');
    $('location').textContent = scene === 'quest' ? q.def.name.toUpperCase() : 'BEDROOM / LOCALHOST'; $('chapter').textContent = state.ending ? 'A window worth opening' : scene === 'quest' ? q.def.genre.toLowerCase() : `${state.completed.length}/12 launches · ${C.hardware[state.tier]}`;
    const p = activeProject();
    if (p && $('build-progress')) {
      const progress = clamp((state.progress[p.id] || 0) / target(p), 0, 1), paused = state.batteryDead && state.tier < 2;
      $('build-progress').style.width = progress * 100 + '%'; $('build-percent').textContent = Math.floor(progress * 100) + '% compiled'; $('build-eta').textContent = ready(p) ? 'Ready to ship' : paused ? 'Charger required' : duration((target(p) - (state.progress[p.id] || 0)) / Math.max(.01, buildRate()) / state.prefs.pace);
      if ($('review-button')) { $('review-button').disabled = state.reviewCooldown > 0; $('review-button').textContent = state.reviewCooldown > 0 ? `Review in ${duration(state.reviewCooldown / state.prefs.pace)}` : 'Review a build · earn focus'; }
      if ($('focus-state')) $('focus-state').textContent = state.focus > 0 ? `Focus active · +20% speed · ${duration(state.focus / state.prefs.pace)}` : 'A thoughtful review boosts development.';
    }
    if ($('build-rate-label')) $('build-rate-label').textContent = buildRate().toFixed(2) + '×';
    $('subtitle').hidden = !(subtitleUntil > clock && scene !== 'title');
    const hint = $('interaction-hint'); hint.hidden = true;
    if (scene !== 'quest') return;
    $('quest-title').textContent = q.def.name;
    let objective = '', value = null, danger = false;
    if (q.mode === 'tactics') objective = 'Choose a Codex ability. Xavier’s confidence is not a health bar.';
    else if (q.mode === 'duel') { objective = `Make Xavier surrender · ${Math.max(0, q.enemy.hp)}/140 resolve\nSpace: slash · Shift: dodge orange warnings`; value = player.hp / 110; }
    else if (q.type === 'woods') objective = 'Follow the woodland path to Xavier. Try not to be intimidated by the weather.';
    else if (q.type === 'platform') { objective = `Reach the charger shrine.\nCheckpoint ${q.checkpointIndex / 4}/4 · Space: jump`; if (distance(player, q.goal) < 2.5) { hint.hidden = false; hint.textContent = 'E · Recover magnetic adapter'; } }
    else if (q.type === 'stealth') { objective = `Access cards ${q.access}/3 · Shift: crouch\nCollect the processor at the far end.`; value = q.detection; danger = true; if (player.z < -49 && Math.abs(player.x) < 3) { hint.hidden = false; hint.textContent = 'E · Open processor cabinet'; } }
    else if (q.type === 'puzzle') objective = `Clear all three circuit sectors. Hints are available on every board.`;
    else if (q.type === 'rhythm') objective = 'Keep the cooling fan in rhythm. D F J K · 45% accuracy to pass.';
    else if (q.type === 'race') { objective = `${Math.min(900, Math.floor(-player.z))}/900 meters\nParcel integrity ${q.integrity}% · Space: hop`; value = q.integrity / 100; }
    else if (q.type === 'survival') { objective = `${duration(Math.max(0, 80 - q.survivalTime))} until exit · Keys ${q.keys}/3\nHold Space: fire · Shift: dash`; value = player.hp / 110; if (q.survivalTime >= 80 && q.keys >= 3 && distance(player, { x: 0, z: -11 }) < 3) { hint.hidden = false; hint.textContent = 'E · Cancel the subscription'; } }
    else if (q.type === 'archive') { objective = `Seed → Window → Path → Sky → Home\n${q.seals}/5 beacons · Next: ${C.archive[q.seals]?.name || 'recover the prism'}`; const near = C.archive.some(pad => distance(player, pad) < 2.5); if (near) { hint.hidden = false; hint.textContent = q.seals >= 5 ? 'E · Recover the Mira prism' : 'E · Listen to the beacon'; } }
    $('objective').textContent = objective; $('quest-meter').hidden = value === null; $('quest-meter').classList.toggle('danger-meter', danger); $('quest-meter').firstElementChild.style.width = clamp(value || 0, 0, 1) * 100 + '%';
    drawMinimap();
  }
  function drawMinimap() {
    const ctx = $('minimap').getContext('2d'); ctx.clearRect(0, 0, 160, 160); ctx.save(); ctx.beginPath(); ctx.arc(80, 80, 78, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = '#24263b'; ctx.fillRect(0, 0, 160, 160);
    const bounds = q.type === 'woods' ? [-27, 27, -135, 10] : q.type === 'platform' ? [-12, 12, -78, 10] : q.type === 'stealth' ? [-16, 16, -57, 7] : q.type === 'archive' ? [-23, 23, -35, 14] : q.type === 'race' ? [-12, 12, player.z - 65, player.z + 25] : [-20, 20, -20, 20];
    const point = (x, z) => [15 + (x - bounds[0]) / (bounds[1] - bounds[0]) * 130, 15 + (z - bounds[2]) / (bounds[3] - bounds[2]) * 130];
    const dot = (x, z, tint, radius = 3) => { const p = point(x, z); ctx.fillStyle = tint; ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, Math.PI * 2); ctx.fill(); };
    if (q.platforms) for (const p of q.platforms) dot(p.x, p.z, '#777295', 3);
    if (q.type === 'archive') C.archive.forEach((p, i) => dot(p.x, p.z, i < q.seals ? '#a6f2d5' : '#cfb6f6', 4));
    for (const p of q.pickups) if (!p.taken) dot(p.x, p.z, p.kind === 'lore' ? '#ffd295' : '#f8b0e0', 3);
    if (q.type === 'woods') dot(q.enemy.x, q.enemy.z, '#ffaf9d', 4);
    if (q.type === 'survival' && q.survivalTime >= 80) dot(0, -11, '#a6f2d5', 5);
    dot(player.x, player.z, '#a6f2d5', 4); ctx.restore();
  }

  function exportSave() {
    save(); const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'The-Fatal-Mistake-save.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function confirmReset() { dialog('Begin a new mistake?', 'This replaces the current local save. Export it from Settings first if you want to keep it.', 'Start a new story', () => { state = defaultState(); hasSave = false; q = null; particles = []; save(); closeModal(); begin(); }); modal.html += `<button class='secondary' data-act='cancel-reset'>Keep current story</button>`; renderModal(); }
  function handleAction(action, button) {
    const id = button?.dataset.id;
    if (action === 'brand') return;
    if (action === 'begin' || action === 'continue') begin();
    else if (action === 'skip') skipIntro();
    else if (action === 'settings') settings();
    else if (action === 'resume') resume();
    else if (action === 'sound') { state.prefs.sound = !state.prefs.sound; if (state.prefs.sound) unlockAudio(); if (modal?.kind === 'settings') renderModal(); save(); }
    else if (action === 'motion') { state.prefs.motion = !state.prefs.motion; document.body.classList.toggle('reduce-motion', state.prefs.motion); renderModal(); save(); }
    else if (action === 'assist') { state.prefs.assist = !state.prefs.assist; renderModal(); save(); }
    else if (action === 'pace') { state.prefs.pace = state.prefs.pace === 1 ? 4 : 1; renderModal(); dirty = true; save(); }
    else if (action === 'view' && scene === 'home') { view = button.dataset.view; dirty = true; }
    else if (action === 'start-project' && scene === 'home') startProject(id);
    else if (action === 'publish') publish();
    else if (action === 'upgrade') buyUpgrade(id);
    else if (action === 'review') openReview();
    else if (action === 'review-answer') reviewAnswer(Number(button.dataset.choice));
    else if (action === 'decision') { const p = activeProject(); if (p && state.decisions[p.id] === undefined) setModal({ kind: 'decision' }); }
    else if (action === 'decision-answer' && modal?.kind === 'decision') { const p = activeProject(); if (p) { state.decisions[p.id] = Number(button.dataset.choice); closeModal(); dirty = true; save(); } }
    else if (action === 'quest' && scene === 'home') startQuest(Number(id));
    else if (action === 'replay' && scene === 'home') startQuest(Number(id), true);
    else if (action === 'retreat') retreat();
    else if (action === 'cancel-retreat') { modal = modal.previousQuestModal; renderModal(); }
    else if (action === 'modal-ok') { const fn = modal?.onOK; closeModal(); if (fn) fn(); }
    else if (action === 'tactic') tactic(button.dataset.move);
    else if (action === 'tile') tile(Number(button.dataset.index));
    else if (action === 'circuit-hint' && q?.type === 'puzzle') { q.puzzle.hint = solveCircuit(q.puzzle.board, q.puzzle.size).findIndex(v => v); renderModal(); }
    else if (action === 'circuit-reset' && q?.type === 'puzzle') { q.puzzle.board = q.puzzle.initial.slice(); q.puzzle.moves = 0; q.puzzle.hint = -1; q.puzzle.solvedTimer = 0; renderModal(); }
    else if (action === 'circuit-solve' && q?.type === 'puzzle' && state.prefs.assist) { q.puzzle.board.fill(0); q.puzzle.solvedTimer = .7; renderModal(); }
    else if (action === 'rhythm-hit') hitRhythm(Number(button.dataset.lane));
    else if (action === 'archive-answer' && modal?.kind === 'archive') { const pad = C.archive[modal.index]; if (Number(button.dataset.choice) === pad.answer) { q.seals++; closeModal(); burst({ x: pad.x, y: 2, z: pad.z }, '#c8ffe2'); tone(783, .35); toast(`${pad.name} beacon restored.`); } else { modal.feedback = 'The beacon hums thoughtfully. Try another answer; nothing has been lost.'; renderModal(); } }
    else if (action === 'export') exportSave();
    else if (action === 'import') $('import-file')?.click();
    else if (action === 'reset') confirmReset();
    else if (action === 'cancel-reset') { closeModal(); if (scene !== 'title') settings(); }
    else if (action === 'ending-home') home();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-act]'); if (!button || button.disabled) return; event.preventDefault(); unlockAudio(); handleAction(button.dataset.act, button);
  });
  document.addEventListener('change', async event => {
    if (event.target.id !== 'import-file') return; const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 200000) throw new Error('This file is too large to be a game save.'); const imported = normalizeSave(JSON.parse(await file.text()));
      dialog('Replace the current save?', 'The selected file is a valid version 1 save. Importing it replaces this device’s current story. An interrupted trip in the imported file will be refunded.', 'Import this save', () => { state = imported; if (state.pending) { state.cash += state.pending.paid; state.pending = null; } hasSave = true; particles = []; home(); toast('Save imported. Welcome back to localhost.'); });
      modal.html += `<button class='secondary' data-act='cancel-reset'>Keep current story</button>`; renderModal();
    } catch (error) { toast(error.message || 'The save could not be imported.'); }
  });
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape') { event.preventDefault(); if (modal?.kind === 'settings') resume(); else settings(); return; }
    if (modal && event.code === 'Tab') { const focusable = [...$('modal-root').querySelectorAll('button:not(:disabled),input:not([hidden])')]; if (focusable.length) { const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { last.focus(); event.preventDefault(); } else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); } } return; }
    if (event.target.matches('input,textarea,select')) return;
    if (scene === 'intro' && !modal && ['Space', 'Enter'].includes(event.code)) { event.preventDefault(); if (!event.repeat) advanceIntro(); return; }
    if (scene === 'title' && !modal && event.code === 'Enter') { event.preventDefault(); begin(); return; }
    if (q?.type === 'rhythm' && modal?.kind === 'rhythm' && ['KeyD', 'KeyF', 'KeyJ', 'KeyK'].includes(event.code)) { event.preventDefault(); if (!event.repeat) hitRhythm(['KeyD', 'KeyF', 'KeyJ', 'KeyK'].indexOf(event.code)); return; }
    if (modal) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) && !event.target.closest('button')) event.preventDefault();
    if (event.target.closest('button') && ['Space', 'Enter'].includes(event.code)) return;
    if (!event.repeat) pressed.add(event.code); keys.add(event.code);
  });
  document.addEventListener('keyup', event => keys.delete(event.code));
  document.querySelectorAll('[data-key]').forEach(button => {
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(button.dataset.key); pressed.add(button.dataset.key); unlockAudio(); });
    const release = () => keys.delete(button.dataset.key); button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  });
  $('world').addEventListener('pointerdown', event => { if (scene !== 'quest' || modal) return; $('world').setPointerCapture(event.pointerId); keys.add('Space'); pressed.add('Space'); unlockAudio(); });
  $('world').addEventListener('pointerup', () => keys.delete('Space')); $('world').addEventListener('pointercancel', () => keys.delete('Space')); $('world').addEventListener('lostpointercapture', () => keys.delete('Space'));
  window.addEventListener('blur', () => { keys.clear(); pressed.clear(); });
  window.addEventListener('resize', syncUI);
  document.addEventListener('visibilitychange', () => { keys.clear(); pressed.clear(); if (document.hidden) { hiddenAt = Date.now(); save(); } else { if (hiddenAt && scene !== 'title') { applyOffline((Date.now() - hiddenAt) / 1000); hiddenAt = 0; save(); dirty = true; } lastFrame = performance.now(); } });
  window.addEventListener('pagehide', save);
  function frame(now) {
    const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
    if (!document.hidden) {
      clock += dt; const paused = modal && !['tactics', 'puzzle', 'rhythm'].includes(modal.kind);
      if (!paused) {
        if (scene === 'intro') { introTime += dt; if (introTime >= C.intro[introIndex].seconds) advanceIntro(); }
        if (scene === 'home' || scene === 'quest') tickEconomy(dt);
        if (scene === 'quest') updateQuest(dt);
        for (const p of particles) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 6 * dt; } particles = particles.filter(p => p.t > 0);
        if (state.prefs.sound && clock > soundtrackTime && !['rhythm'].includes(q?.type) && scene !== 'title') { soundtrackTime = clock + 4; const root = [130.81, 110, 146.83, 98][Math.floor(clock / 16) % 4]; tone(root, 2.4, .014); tone(root * 1.5, 2.2, .009); }
      }
      saveTimer += dt; hudTimer += dt; screenTimer += dt;
      if (saveTimer >= 10 && scene !== 'title') { saveTimer = 0; save(); }
      if (screenTimer > .25) { screenTimer = 0; paintScreen(); }
      if (dirty && scene === 'home') renderPanel();
      if (hudTimer > .2) { hudTimer = 0; updateHUD(); const length = toasts.length; toasts = toasts.filter(t => t.until > clock); if (toasts.length !== length) renderToasts(); }
      drawWorld(dt); if (scene === 'quest' && q.type === 'rhythm') drawRhythm();
      pressed.clear();
    }
    requestAnimationFrame(frame);
  }
  const awaySeconds = (Date.now() - state.savedAt) / 1000;
  if (state.pending) { state.cash += state.pending.paid; state.pending = null; toast('Your interrupted expedition’s travel ticket has been refunded.'); }
  if (hasSave) applyOffline(awaySeconds);
  if (loadWarning) toast(loadWarning);
  syncUI(); paintScreen(); updateHUD(); requestAnimationFrame(frame);
})();
