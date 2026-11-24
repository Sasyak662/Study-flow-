/* StudyStarx laptop "game lobby" home (windows 701px and wider). Phones and tablets keep the normal layout. */
(function () {
  if (window.__lapLobby) return; window.__lapLobby = 1;
  var MQ = window.matchMedia('(min-width:701px)');
  var root = document.documentElement;
  var lobby, homeBtn, lastHtml = '';
  try { root.setAttribute('data-lbbg', localStorage.getItem('sf-lobby-bg') || 'galaxy'); } catch (e) {}

  var CSS = `
html.lap .app{display:block}
html.lap #sidebar{display:none!important}
html.lap .app>main{margin:0 auto;max-width:1400px}
html.lap header.top{align-items:center}
#lapHomeBtn{display:none}
html.lap #lapHomeBtn{display:flex;align-items:center;gap:10px;margin-right:auto;height:48px;padding:0 18px 0 6px;border:0;border-radius:16px;background:#fff;color:#2b1f8f;font:800 15px inherit;font-family:inherit;cursor:pointer;box-shadow:inset 0 -4px 0 #e2defa,0 10px 20px -14px rgba(40,20,120,.5);transition:transform .12s}
html.lap #lapHomeBtn:hover{transform:translateY(-2px)}
html.lap #lapHomeBtn:active{transform:translateY(2px);box-shadow:inset 0 -1px 0 #e2defa}
html.lap #lapHomeBtn i{width:40px;height:40px;background:url(/dock/home.webp) center/contain no-repeat}
html.lap #lapHomeBtn b{font-size:15px}
html.lap #lapHomeBtn span{color:#8a88a3;font-weight:700}
#lapLobby{display:none}
html.lap.lap-home{background:#140c3a}
html.lap.lap-home body{background:var(--lbbg) fixed!important;min-height:100vh;transition:background .4s}
html.lap.lap-home{--lbbg:radial-gradient(60% 50% at 15% 0%,#3a22b8 0,transparent 70%),radial-gradient(50% 50% at 100% 100%,#5b1aa8 0,transparent 70%),#140c3a}
html.lap.lap-home[data-lbbg=ocean]{--lbbg:radial-gradient(60% 50% at 10% 0%,#0a7fb8 0,transparent 70%),radial-gradient(55% 55% at 100% 100%,#00b3a4 0,transparent 70%),#04233a}
html.lap.lap-home[data-lbbg=sunset]{--lbbg:radial-gradient(60% 55% at 0% 0%,#ff5f6d 0,transparent 70%),radial-gradient(60% 60% at 100% 100%,#ffb03a 0,transparent 70%),radial-gradient(50% 50% at 100% 0%,#b0306a 0,transparent 70%),#3a0f35}
html.lap.lap-home[data-lbbg=aurora]{--lbbg:radial-gradient(70% 45% at 20% 0%,#19c98a 0,transparent 70%),radial-gradient(50% 50% at 90% 15%,#2f7bff 0,transparent 70%),radial-gradient(50% 50% at 60% 100%,#8a3dff 0,transparent 70%),#061f24}
html.lap.lap-home[data-lbbg=berry]{--lbbg:radial-gradient(60% 50% at 15% 0%,#e0338f 0,transparent 70%),radial-gradient(55% 55% at 100% 100%,#7b2ff7 0,transparent 70%),#2a0a35}
html.lap.lap-home[data-lbbg=lava]{--lbbg:radial-gradient(60% 50% at 0% 100%,#ff4d1c 0,transparent 70%),radial-gradient(55% 55% at 100% 0%,#d4143c 0,transparent 70%),#2a0808}
html.lap.lap-home[data-lbbg=rainbow]{--lbbg:radial-gradient(45% 45% at 0% 0%,#ff4d8d 0,transparent 70%),radial-gradient(45% 45% at 100% 0%,#ffb020 0,transparent 70%),radial-gradient(45% 45% at 100% 100%,#22c3ee 0,transparent 70%),radial-gradient(45% 45% at 0% 100%,#7c4dff 0,transparent 70%),radial-gradient(40% 40% at 50% 50%,#22d38a 0,transparent 75%),#1b1240}
html.lap.lap-home[data-lbbg=midnight]{--lbbg:radial-gradient(60% 50% at 50% 0%,#1d2a5c 0,transparent 70%),#05060f}
.lb-pal{position:absolute;right:56px;top:58px;z-index:20;width:300px;padding:14px;border-radius:20px;background:#fff;color:#16142e;box-shadow:0 30px 60px -20px rgba(0,0,0,.6)}
.lb-pal b{display:block;font-size:15px;margin:0 0 10px 2px}
.lb-sw{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.lb-sw button{display:flex;flex-direction:column;align-items:center;gap:5px;padding:0;border:0;background:none;color:#3d3a5c;font-weight:700;font-size:12px}
.lb-sw i{width:56px;height:56px;border-radius:16px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.lb-sw button[aria-pressed=true] i{outline:3px solid #4b2fe0;outline-offset:2px}
.lb-sw button:focus-visible{outline:none}.lb-sw button:focus-visible i{outline:3px solid #ffb020;outline-offset:2px}
html.lap.lap-home header.top{display:none!important}
html.lap.lap-home #page-dashboard>*:not(#lapLobby){display:none!important}
html.lap.lap-home body #page-dashboard>#lapLobby{display:block!important}
html.lap.lap-home .app>main{padding-top:24px}
#lapLobby{position:relative;color:#fff;font-family:inherit}
#lapLobby .lb-sky{position:fixed;inset:0;pointer-events:none;z-index:0}
#lapLobby .lb-sky i{position:absolute;background:#fff;border-radius:50%;opacity:.35;animation:lbTw 4s ease-in-out infinite}
@keyframes lbTw{50%{opacity:.08}}
#lapLobby>*:not(.lb-sky){position:relative;z-index:1}
#lapLobby h1,#lapLobby h2,#lapLobby h3{margin:0;color:#fff;letter-spacing:-.01em}
#lapLobby p{margin:0}
#lapLobby button{font-family:inherit;cursor:pointer}
.lb-top{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.lb-brand{display:flex;align-items:center;gap:8px;margin-right:auto;font-weight:800;font-size:22px}
.lb-lvl{display:flex;align-items:center;gap:10px;padding:6px 16px 6px 6px;border-radius:999px;background:rgba(255,255,255,.1);border:0;color:#fff}
.lb-lvl>b{width:34px;height:34px;border-radius:50%;background:#ffd65a;color:#3b2600;display:grid;place-items:center;font-size:15px}
.lb-lvl small{display:block;font-weight:700;color:#cfc8ff;font-size:12.5px;text-align:left}
.lb-xp{width:150px;height:8px;border-radius:9px;background:rgba(255,255,255,.18);margin-top:3px;overflow:hidden}
.lb-xp i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#ffd65a,#ff9f1c)}
.lb-chip{display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 15px;border-radius:999px;background:rgba(255,255,255,.1);border:0;color:#fff;font-weight:800;font-size:15px}
.lb-chip:hover,.lb-lvl:hover{background:rgba(255,255,255,.18)}
.lb-av{width:44px;height:44px;border-radius:50%;border:0;background:#ffd65a;color:#3b2600;font-weight:800;font-size:17px}
.lb-row{display:grid;grid-template-columns:1.35fr 1fr;gap:22px}
.lb-hero{position:relative;border-radius:30px;padding:30px 34px;background:linear-gradient(135deg,#6a4bff,#4b2fe0 60%,#3a1fc4);box-shadow:0 0 0 2px rgba(255,214,90,.35),0 30px 60px -30px #000;overflow:hidden;min-height:290px}
.lb-hero .lb-star{position:absolute;right:-6px;top:-18px;filter:drop-shadow(0 0 30px rgba(255,214,90,.7));animation:lbStar 5s ease-in-out infinite}
@keyframes lbStar{50%{transform:rotate(8deg) scale(1.04)}}
.lb-hero .d{color:#d9d6ff;font-weight:700}
.lb-hero h1{font-size:38px;margin:6px 0!important}
.lb-hero .s{color:#e4e2ff;font-weight:600;margin-bottom:22px!important;max-width:400px;line-height:1.45}
.lb-btns{display:flex;gap:10px;flex-wrap:wrap}
.lb-b{height:56px;padding:0 26px;border:0;border-radius:16px;font-weight:800;font-size:16px;display:inline-flex;align-items:center;gap:8px;transition:transform .12s}
.lb-b:hover{transform:translateY(-2px)}
.lb-b:active{transform:translateY(2px)}
.lb-b.gold{background:#ffd65a;color:#3b2600;box-shadow:inset 0 -5px 0 rgba(0,0,0,.16)}
.lb-b.gold:active{box-shadow:inset 0 -2px 0 rgba(0,0,0,.16)}
.lb-b.ghost{background:rgba(255,255,255,.16);color:#fff}
.lb-mis{border-radius:30px;padding:22px 24px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.lb-mh{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.lb-mh h2{font-size:19px}
.lb-mh span{font-weight:800;color:#ffd65a}
.lb-ml{display:grid;gap:10px}
.lb-mi{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.07);border:0;color:#fff;text-align:left;transition:background .15s}
.lb-mi:hover{background:rgba(255,255,255,.13)}
.lb-mi .c{width:30px;height:30px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:800;box-shadow:inset 0 0 0 2px rgba(255,255,255,.3)}
.lb-mi .t{flex:1;min-width:0}
.lb-mi .t b{display:block;font-size:15px}
.lb-mi .t small{color:#bdb7e8;font-size:13px}
.lb-mi .g{font-weight:800;color:#ffd65a;font-size:14px;white-space:nowrap}
.lb-mi.done{background:rgba(52,224,161,.15)}
.lb-mi.done .c{background:#34e0a1;color:#063;box-shadow:none}
.lb-mi.done .t b{text-decoration:line-through;opacity:.7}
.lb-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:44px 20px;margin-top:44px;padding-bottom:30px}
.lb-t{position:relative;height:170px;border:0;border-radius:26px;padding:18px 18px 18px 128px;color:#fff;text-align:left;display:flex;flex-direction:column;justify-content:flex-end;box-shadow:inset 0 -6px 0 rgba(0,0,0,.2),inset 0 2px 0 rgba(255,255,255,.3),0 18px 30px -14px rgba(0,0,0,.6);transition:transform .15s}
.lb-t:hover{transform:translateY(-4px)}
.lb-t:active{transform:translateY(2px);box-shadow:inset 0 -2px 0 rgba(0,0,0,.2),0 8px 16px -10px rgba(0,0,0,.6)}
.lb-t:focus-visible,.lb-b:focus-visible,.lb-mi:focus-visible,.lb-chip:focus-visible{outline:3px solid #ffd65a;outline-offset:3px}
.lb-t .ic{position:absolute;left:12px;top:-26px;width:110px;height:110px;filter:drop-shadow(0 12px 12px rgba(0,0,0,.35));background:center/contain no-repeat;display:grid;place-items:center;font-size:66px;line-height:1;transition:transform .2s}
.lb-t:hover .ic{transform:translateY(-6px) rotate(-4deg)}
.lb-t .ic.drag{background-image:url(/dock/dragon.webp);background-size:1600% 100%;background-position:0 0;animation:lbDrag 1.6s steps(15) infinite}
@keyframes lbDrag{to{background-position:100% 0}}
.lb-t h3{font-size:19px}
.lb-t p{font-size:13.5px;font-weight:700;color:rgba(255,255,255,.88)}
.lb-t .bd{position:absolute;top:14px;right:14px;height:28px;padding:0 10px;border-radius:999px;background:#fff;color:#16142e;font-weight:800;font-size:13px;display:flex;align-items:center;box-shadow:0 4px 10px -4px rgba(0,0,0,.4)}
.lb-t.hot{outline:3px solid #ffd65a;outline-offset:3px}
.lb-menu{position:absolute;right:56px;top:58px;z-index:20;width:280px;padding:8px;border-radius:20px;background:#fff;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);display:grid;gap:2px}
.lb-menu button{display:flex;align-items:center;gap:10px;width:100%;height:44px;padding:0 14px;border:0;border-radius:12px;background:none;color:#16142e;font-weight:700;font-size:15px;text-align:left}
.lb-menu button:hover,.lb-menu button:focus-visible{background:#f1effc;outline:none}
.lb-menu button span{width:26px;text-align:center}
@media (max-width:1340px){.lb-t{padding-left:18px;padding-top:86px;height:180px}.lb-t .ic{width:92px;height:92px;top:-22px;font-size:56px}.lb-hero h1{font-size:32px}}
@media (max-width:1080px){.lb-row{grid-template-columns:1fr}.lb-hero{min-height:0}.lb-hero .lb-star svg{width:150px;height:150px}.lb-lvl small,.lb-xp{display:none}.lb-lvl{padding:4px}}
@media (max-width:900px){.lb-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.lb-brand{font-size:19px}.lb-chip{padding:0 11px;font-size:14px}.lb-hero h1{font-size:28px}}
@media (prefers-reduced-motion:reduce){#lapLobby *{animation:none!important;transition:none!important}}
`;

  var TILES = [
    { go: 'coach', name: 'Coach', ic: 'url(/dock/coach.webp)', bg: 'linear-gradient(150deg,#8f7bff,#5a3cf0)' },
    { go: 'quest', name: 'StudyQuest', drag: 1, bg: 'linear-gradient(150deg,#ff8a4c,#e0431f)', hot: 1 },
    { go: 'timetable', name: 'Timetable', ic: 'url(/dock/timetable.webp)', bg: 'linear-gradient(150deg,#38c7ff,#1678e6)' },
    { go: 'quiz', name: 'Practice', emo: '🎯', bg: 'linear-gradient(150deg,#ff6f9a,#d81b60)' },
    { go: 'library', name: 'My notes', emo: '📝', bg: 'linear-gradient(150deg,#c084fc,#8b2fe0)' },
    { go: 'focuslock', name: 'Focus', emo: '⏱️', bg: 'linear-gradient(150deg,#34e0a1,#0d9a6a)' },
    { go: 'progress', name: 'Progress', emo: '📈', bg: 'linear-gradient(150deg,#ffcf4d,#f08a00)' },
    { go: 'resources', name: 'Books', emo: '📚', bg: 'linear-gradient(150deg,#f472b6,#be185d)' }
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function D() { try { var d = (0, eval)('typeof data!=="undefined"?data:null'); return d || window.data || {}; } catch (e) { return window.data || {}; } }
  function nav(p) { try { if (typeof window.go === 'function') return window.go(p); } catch (e) {} var b = document.querySelector('#nav [data-page="' + p + '"]'); if (b) b.click(); }
  function star(w) { return '<svg width="' + w + '" height="' + w + '" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="lbg' + w + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c8"/><stop offset=".6" stop-color="#ffd65a"/><stop offset="1" stop-color="#ffa62b"/></linearGradient></defs><path d="M12 1.5l2.6 6.9 6.9 2.6-6.9 2.6L12 20.5l-2.6-6.9L2.5 11l6.9-2.6z" fill="url(#lbg' + w + ')"/></svg>'; }

  function stats() {
    var d = D(), isl = d.island || {}, q = d.quest || {}, S = window.StudyFlowIsland, lvl = 1, coins = +isl.coins || 0;
    try { if (S && S.level) lvl = S.level() || 1; if (S && S.state && S.state.coins != null) coins = +S.state.coins || 0; } catch (e) {}
    var streak = 0, chip = document.querySelector('#sxHome .sxh-chips [data-sxgo="progress"] b');
    if (chip) streak = +chip.textContent || 0;
    var xp = +isl.xp || +q.xp || 0;
    return { lvl: lvl, coins: coins, gems: +isl.gems || 0, streak: streak, xpPct: Math.max(4, Math.min(100, xp % 100)) };
  }

  function missions() {
    return Array.prototype.map.call(document.querySelectorAll('#sxHome .sxh-mission .sxh-item'), function (el, i) {
      var b = el.querySelector('b'), s = el.querySelector('small'), g = el.querySelector('.sxh-go');
      return { i: i, title: b ? b.textContent : '', sub: s ? s.textContent : '', done: el.classList.contains('done'), go: g ? g.dataset.sxgo : '', label: g ? g.textContent : '' };
    });
  }

  function examLine() {
    var ex = (D().exams || []).filter(function (e) { return e && e.date; }).map(function (e) { return { n: e.subject || e.name || 'Your', t: new Date(e.date) }; })
      .filter(function (e) { return !isNaN(e.t) && e.t > Date.now() - 864e5; }).sort(function (a, b) { return a.t - b.t; })[0];
    if (!ex) return '';
    var days = Math.max(0, Math.ceil((ex.t - new Date().setHours(0, 0, 0, 0)) / 864e5));
    return esc(ex.n) + ' exam ' + (days === 0 ? 'is today' : days === 1 ? 'is tomorrow' : 'in ' + days + ' days') + '. ';
  }

  function render() {
    if (!lobby) return;
    var d = D(), st = stats(), ms = missions(), left = ms.filter(function (m) { return !m.done; }).length;
    var name = ((d.profile || {}).name || '').split(' ')[0];
    var hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    var date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    var sub = examLine() + (ms.length ? (left ? 'Finish today’s mission' + (st.streak ? ' to keep your ' + st.streak + '-day streak.' : ' to start a streak.') : 'Mission complete. Great work today!') : 'Pick something below to get started.');
    var notes = (d.notes || []).length, due = 0;
    try { due = (d.flashcards || []).filter(function (c) { return c && c.due && new Date(c.due) <= new Date(); }).length; } catch (e) {}
    var subs = {
      coach: 'Ask anything, any time', quest: 'Level ' + st.lvl + ' · battle for coins', timetable: 'Plan your week',
      quiz: due ? due + ' cards to review' : 'Quiz of the day', library: notes ? notes + (notes === 1 ? ' note' : ' notes') + ' saved' : 'Save your notes',
      focuslock: 'Block distractions', progress: st.streak ? st.streak + '-day streak' : 'See how you’re doing', resources: 'Study guides'
    };
    var badges = { quest: '⚔ Boss' }; if (due) badges.quiz = due + ' due'; if (notes) badges.library = String(notes);

    var h = '<div class="lb-top"><span class="lb-brand">' + star(30) + 'StudyStarx</span>' +
      '<button type="button" class="lb-lvl" data-lb="quest" aria-label="Level ' + st.lvl + '. Open StudyQuest"><b>' + st.lvl + '</b><span><small>Level ' + st.lvl + '</small><div class="lb-xp"><i style="width:' + st.xpPct + '%"></i></div></span></button>' +
      '<button type="button" class="lb-chip" data-lb="progress" aria-label="' + st.streak + ' day streak">🔥 ' + st.streak + '</button>' +
      '<button type="button" class="lb-chip" data-lb="quest" aria-label="' + st.coins + ' coins">🪙 ' + st.coins + '</button>' +
      '<button type="button" class="lb-chip" data-lb="quest" aria-label="' + st.gems + ' gems">💎 ' + st.gems + '</button>' +
      '<button type="button" class="lb-chip" data-lb="#bg" aria-label="Change background">🎨</button>' +
      '<button type="button" class="lb-chip" data-lb="#more">☰ More</button>' +
      '<button type="button" class="lb-av" data-lb="#avatar" aria-label="Account">' + esc((name || 'S').charAt(0).toUpperCase()) + '</button></div>' +
      '<div class="lb-row"><section class="lb-hero"><div class="lb-star">' + star(210) + '</div>' +
      '<p class="d">' + esc(date) + '</p><h1>' + (name ? 'Ready, ' + esc(name) + '?' : hi + '!') + '</h1><p class="s">' + sub + '</p>' +
      '<div class="lb-btns"><button type="button" class="lb-b gold" data-lb="#start">▶ ' + (left ? 'Start mission' : 'Keep studying') + '</button><button type="button" class="lb-b ghost" data-lb="coach">Ask the coach</button></div></section>' +
      '<section class="lb-mis" aria-label="Today’s mission"><div class="lb-mh"><h2>Today’s mission</h2><span>' + (ms.length - left) + ' / ' + ms.length + '</span></div><div class="lb-ml">' +
      ms.slice(0, 4).map(function (m, i) {
        return '<button type="button" class="lb-mi' + (m.done ? ' done' : '') + '" data-lbm="' + m.i + '"><span class="c">' + (m.done ? '✓' : '') + '</span><span class="t"><b>' + esc(m.title) + '</b><small>' + esc(m.sub) + '</small></span><span class="g">' + (m.done ? 'Done' : esc(m.label) + ' ›') + '</span></button>';
      }).join('') + '</div></section></div>' +
      '<div class="lb-tiles">' + TILES.map(function (t) {
        var ic = t.drag ? '<span class="ic drag" aria-hidden="true"></span>' : t.ic ? '<span class="ic" style="background-image:' + t.ic + '" aria-hidden="true"></span>' : '<span class="ic" aria-hidden="true">' + t.emo + '</span>';
        return '<button type="button" class="lb-t' + (t.hot ? ' hot' : '') + '" data-lb="' + t.go + '" style="background:' + t.bg + '">' + ic + (badges[t.go] ? '<span class="bd">' + badges[t.go] + '</span>' : '') + '<h3>' + t.name + '</h3><p>' + esc(subs[t.go]) + '</p></button>';
      }).join('') + '</div>';

    if (h === lastHtml || lobby.querySelector('.lb-menu,.lb-pal')) return;
    lastHtml = h;
    var body = lobby.querySelector('.lb-body');
    body.innerHTML = h;
  }

  function sky() {
    var s = '', x = 7;
    for (var i = 0; i < 70; i++) {
      x = (x * 9301 + 49297) % 233280; var l = x / 2332.8; x = (x * 9301 + 49297) % 233280; var t = x / 2332.8; x = (x * 9301 + 49297) % 233280; var z = 1.5 + x / 233280 * 3;
      s += '<i style="left:' + l.toFixed(1) + '%;top:' + t.toFixed(1) + '%;width:' + z.toFixed(1) + 'px;height:' + z.toFixed(1) + 'px;animation-delay:' + (i % 9 * 0.45).toFixed(2) + 's"></i>';
    }
    return '<div class="lb-sky" aria-hidden="true">' + s + '</div>';
  }

  var EMO = { dashboard: '🏠', coach: '💬', library: '📝', upload: '📤', quiz: '🎯', flashcards: '🃏', mastery: '🧠', quest: '🐉', examiner: '✅', timetable: '📅', focuslock: '⏱️', director: '🗓️', progress: '📈', resources: '📚', premium: '⭐', cart: '🛒', settings: '⚙️' };
  var BGS = [['galaxy', 'Galaxy', '#140c3a', '#3a22b8', '#5b1aa8'], ['ocean', 'Ocean', '#04233a', '#0a7fb8', '#00b3a4'], ['sunset', 'Sunset', '#3a0f35', '#ff5f6d', '#ffb03a'], ['aurora', 'Aurora', '#061f24', '#19c98a', '#8a3dff'],
    ['berry', 'Berry', '#2a0a35', '#e0338f', '#7b2ff7'], ['lava', 'Lava', '#2a0808', '#ff4d1c', '#d4143c'], ['rainbow', 'Rainbow', '#1b1240', '#ff4d8d', '#22c3ee'], ['midnight', 'Midnight', '#05060f', '#1d2a5c', '#05060f']];
  function getBg() { try { return localStorage.getItem('sf-lobby-bg') || 'galaxy'; } catch (e) { return 'galaxy'; } }
  function setBg(k) { root.setAttribute('data-lbbg', k); try { localStorage.setItem('sf-lobby-bg', k); } catch (e) {} }
  function togglePal() {
    if (lobby.querySelector('.lb-pal')) return closeMenu();
    closeMenu();
    var cur = getBg(), m = document.createElement('div'); m.className = 'lb-pal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Background');
    m.innerHTML = '<b>Background</b><div class="lb-sw">' + BGS.map(function (b) {
      var sw = b[0] === 'rainbow' ? 'linear-gradient(135deg,#ff4d8d,#ffb020,#22d38a,#22c3ee,#7c4dff)' : 'radial-gradient(80% 80% at 0% 0%,' + b[3] + ',transparent 75%),radial-gradient(80% 80% at 100% 100%,' + b[4] + ',transparent 75%),' + b[2];
      return '<button type="button" data-bg="' + b[0] + '" aria-pressed="' + (b[0] === cur) + '"><i style="background:' + sw + '"></i>' + b[1] + '</button>';
    }).join('') + '</div>';
    m.addEventListener('click', function (e) { var t = e.target.closest('[data-bg]'); if (!t) return; setBg(t.dataset.bg); m.querySelectorAll('[data-bg]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === t)); }); });
    lobby.querySelector('.lb-body').appendChild(m);
    var f = m.querySelector('[aria-pressed=true]'); if (f) f.focus();
  }
  function closeMenu() { if (!lobby) return; lobby.querySelectorAll('.lb-menu,.lb-pal').forEach(function (m) { m.remove(); }); }
  function toggleMenu(btn) {
    if (lobby.querySelector('.lb-menu')) return closeMenu();
    var m = document.createElement('div'); m.className = 'lb-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = Array.prototype.filter.call(document.querySelectorAll('#nav [data-page]'), function (b) { return !b.hidden && b.style.display !== 'none' && b.dataset.page !== 'dashboard'; })
      .map(function (b) { var t = (b.childNodes.length ? Array.prototype.map.call(b.childNodes, function (n) { return n.nodeType === 3 ? n.textContent : (n.tagName === 'SPAN' && !/^\d+$/.test(n.textContent.trim()) ? n.textContent : ''); }).join('') : b.textContent).trim() || b.textContent.trim();
        return '<button type="button" role="menuitem" data-lb="' + b.dataset.page + '"><span>' + (EMO[b.dataset.page] || '•') + '</span>' + esc(t.replace(/\d+$/, '')) + '</button>'; }).join('');
    lobby.querySelector('.lb-body').appendChild(m);
    var f = m.querySelector('button'); if (f) f.focus();
  }
  document.addEventListener('click', function (e) { if (lobby && !e.target.closest('.lb-menu,.lb-pal,[data-lb="#more"],[data-lb="#bg"]')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  function onClick(e) {
    var m = e.target.closest('[data-lbm]');
    if (m) { var orig = document.querySelectorAll('#sxHome .sxh-mission .sxh-item .sxh-go')[+m.dataset.lbm]; if (orig) orig.click(); return; }
    var b = e.target.closest('[data-lb]'); if (!b) return;
    var a = b.dataset.lb;
    if (a === '#start') { var next = document.querySelector('#sxHome .sxh-mission .sxh-item:not(.done) .sxh-go'); if (next) next.click(); else nav('quiz'); return; }
    if (a === '#more') { if (lobby.querySelector('.lb-pal')) closeMenu(); toggleMenu(b); return; }
    if (a === '#bg') { togglePal(); return; }
    if (a === '#avatar') { var av = document.getElementById('avatar'); if (av) av.click(); else nav('settings'); return; }
    closeMenu(); nav(a);
  }

  function isHome() { var p = document.getElementById('page-dashboard'); return !!(p && p.classList.contains('active')); }
  function sync() {
    var on = MQ.matches;
    root.classList.toggle('lap', on);
    root.classList.toggle('lap-home', on && isHome());
    if (on && isHome()) render();
  }

  function init() {
    var page = document.getElementById('page-dashboard'), header = document.querySelector('header.top');
    if (!page || !header) return setTimeout(init, 300);
    var st = document.createElement('style'); st.id = 'lapLobbyCss'; st.textContent = CSS; document.head.appendChild(st);
    lobby = document.createElement('div'); lobby.id = 'lapLobby';
    lobby.innerHTML = sky() + '<div class="lb-body"></div>';
    lobby.addEventListener('click', onClick);
    page.insertBefore(lobby, page.firstChild);
    homeBtn = document.createElement('button'); homeBtn.type = 'button'; homeBtn.id = 'lapHomeBtn';
    homeBtn.innerHTML = '<i aria-hidden="true"></i><b>Home</b>';
    homeBtn.onclick = function () { nav('dashboard'); };
    header.insertBefore(homeBtn, header.firstChild);
    document.querySelectorAll('main .page').forEach(function (p) { new MutationObserver(sync).observe(p, { attributes: true, attributeFilter: ['class'] }); });
    var mis = document.querySelector('#sxHome');
    if (mis) new MutationObserver(function () { if (root.classList.contains('lap-home')) { clearTimeout(init.t); init.t = setTimeout(render, 120); } }).observe(mis, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    if (MQ.addEventListener) MQ.addEventListener('change', sync); else MQ.addListener(sync);
    setInterval(function () { if (root.classList.contains('lap-home') && !document.hidden) render(); }, 4000);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
