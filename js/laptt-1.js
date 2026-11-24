/* StudyStarx laptop timetable: "game board" look on windows 701px and wider (matches the laptop home).
   It only restyles the existing timetable, so dragging, marking done, homework and planning keep working. */
(function () {
  if (window.__lapTT) return; window.__lapTT = 1;
  var root = document.documentElement, side, lastSide = '';

  var CSS = `
html.lap.lap-tt body{background:radial-gradient(60% 50% at 15% 0%,#3a22b8 0,transparent 70%),radial-gradient(50% 50% at 100% 100%,#5b1aa8 0,transparent 70%),#140c3a fixed!important;min-height:100vh}
html.lap.lap-tt header.top{color:#cfc8ff}
html.lap.lap-tt header.top *{--muted:#bdb7e8}
html.lap.lap-tt header.top .sfcartbtn{background:rgba(255,255,255,.1)!important;color:#fff!important;border-color:transparent!important}
html.lap.lap-tt #lapHomeBtn{background:rgba(255,255,255,.1);color:#fff;box-shadow:none}
html.lap.lap-tt #lapHomeBtn:hover{background:rgba(255,255,255,.18)}
html.lap.lap-tt #ttTab{color:#fff}
html.lap.lap-tt #page-timetable .tt-card:not(.tt-cal-wrap),html.lap.lap-tt #page-timetable .tq,html.lap.lap-tt #page-timetable .ttm-card{color:#16142e}
html.lap.lap-tt .page.active>.sfm-tabs{background:rgba(255,255,255,.07)!important;border:0!important;box-shadow:none!important}
html.lap.lap-tt .page.active>.sfm-tabs button{color:#cfc8ff!important;background:transparent!important;font-weight:800}
html.lap.lap-tt .page.active>.sfm-tabs button.on{background:#fff!important;color:#2b1f8f!important}
/* layout: calendar + side panel */
html.lap.lap-tt #page-timetable.active{display:grid!important;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}
html.lap.lap-tt #page-timetable>*{grid-column:1}
html.lap.lap-tt #page-timetable>.sfm-tabs{grid-column:1/-1}
html.lap.lap-tt #page-timetable>#lapTTside{grid-column:2;grid-row:2 / span 6;position:sticky;top:20px}
html.lap.lap-tt #ttBody{max-width:none!important;width:auto!important;margin:0!important}
@media (max-width:1180px){html.lap.lap-tt #page-timetable.active{grid-template-columns:minmax(0,1fr)}html.lap.lap-tt #page-timetable>#lapTTside{display:none}}
/* hero */
html.lap.lap-tt #page-timetable .tt-hero2{background:linear-gradient(135deg,#6a4bff,#4b2fe0 60%,#3a1fc4)!important;border-radius:28px!important;box-shadow:0 0 0 2px rgba(255,214,90,.35),0 30px 60px -30px #000!important;position:relative;overflow:hidden}
html.lap.lap-tt #page-timetable .tt-hero2 .tt-h0i{display:none}
html.lap.lap-tt #page-timetable .tt-hero2>.tt-h2top{padding-left:96px;position:relative;min-height:80px}
html.lap.lap-tt #page-timetable .tt-hero2>.tt-h2top::before{content:"";position:absolute;left:0;top:0;width:80px;height:80px;background:url(/dock/timetable.webp) center/contain no-repeat;filter:drop-shadow(0 10px 12px rgba(0,0,0,.35))}
html.lap.lap-tt #page-timetable .tt-hero2 .tt-make,html.lap.lap-tt #page-timetable .tt-hero2 .tt-hact>button:first-child{background:#ffd65a!important;color:#3b2600!important;border:0!important;border-radius:16px!important;font-weight:800!important;box-shadow:inset 0 -5px 0 rgba(0,0,0,.16)!important;min-height:48px;padding:0 22px!important}
html.lap.lap-tt #page-timetable .tt-hero2 .tt-make:active{transform:translateY(2px)}
/* section tabs */
html.lap.lap-tt #page-timetable .tt-tabs{background:transparent!important;border:0!important;box-shadow:none!important;gap:10px;padding:0!important}
html.lap.lap-tt #page-timetable .tt-tabs button{background:rgba(255,255,255,.1)!important;color:#fff!important;border-radius:999px!important;font-weight:800!important;border:0!important;box-shadow:none!important}
html.lap.lap-tt #page-timetable .tt-tabs button.on{background:#fff!important;color:#2b1f8f!important}
/* cards */
html.lap.lap-tt #page-timetable .tt-cal-wrap,html.lap.lap-tt #page-timetable .tt-onb{background:rgba(255,255,255,.06)!important;border:0!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)!important;color:#fff!important;border-radius:26px!important}
html.lap.lap-tt #page-timetable .tt-card:not(.tt-cal-wrap),html.lap.lap-tt #page-director .card{border-radius:24px!important;border:0!important;box-shadow:0 20px 40px -24px rgba(0,0,0,.6)!important}
html.lap.lap-tt #page-timetable .tt-onb-s>div{background:rgba(255,255,255,.07)!important;border:0!important;color:#e4e2ff}
html.lap.lap-tt #page-timetable .tt-onb a{color:#ffd65a}
html.lap.lap-tt #page-timetable .tt-cal-wrap .tt-hint,html.lap.lap-tt #page-timetable .tt-cal-wrap .tt-legend,html.lap.lap-tt #page-timetable .tt-onb small{color:#bdb7e8!important}
html.lap.lap-tt #page-timetable .tt-cal-wrap h3,html.lap.lap-tt #page-timetable .tt-onb b{color:#fff!important}
html.lap.lap-tt #ttTab :is(b,h2,h3,h4,span,small,p):not(.tt-card *):not(.tq *):not(.ttm-card *):not(.tt-item *):not(.tt-cal-wrap *){color:#e4e2ff}
html.lap.lap-tt #page-timetable .tt-cal-wrap input,html.lap.lap-tt #page-timetable .tt-cal-wrap select{background:#fff!important;color:#16142e!important}
html.lap.lap-tt #page-timetable .tt-b.d{background:rgba(255,255,255,.1)!important;color:#fff!important;border:0!important}
/* calendar */
html.lap.lap-tt #page-timetable .tt-cal{background:transparent!important;border:0!important}
html.lap.lap-tt #page-timetable .tt-ch{background:transparent!important;color:#fff!important;border:0!important;font-weight:800;border-radius:12px}
html.lap.lap-tt #page-timetable .tt-ch small{color:#bdb7e8!important}
html.lap.lap-tt #page-timetable .tt-ch.today{background:#ffd65a!important;color:#3b2600!important}
html.lap.lap-tt #page-timetable .tt-ch.today small{color:#6b4a00!important}
html.lap.lap-tt #page-timetable .tt-hours{border:0!important}
html.lap.lap-tt #page-timetable .tt-hours span{color:#8c86b8!important;font-weight:700}
html.lap.lap-tt #page-timetable .tt-col{background-color:rgba(255,255,255,.035)!important;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px)!important;background-size:100% var(--hh,44px)!important;border:0!important;border-radius:16px;margin:0 3px}
html.lap.lap-tt #page-timetable .tt-col.lap-today{background-color:rgba(255,214,90,.08)!important;box-shadow:inset 0 0 0 2px #ffd65a}
html.lap.lap-tt #page-timetable .tt-blk{border-radius:12px!important;border:0!important}
html.lap.lap-tt #page-timetable .tt-blk.study{background:linear-gradient(150deg,color-mix(in srgb,var(--c) 72%,#fff),var(--c))!important;color:#fff!important;box-shadow:inset 0 -4px 0 rgba(0,0,0,.2),0 8px 14px -8px rgba(0,0,0,.6)!important;font-size:12.5px;padding:5px 8px!important}
html.lap.lap-tt #page-timetable .tt-blk.study small{color:rgba(255,255,255,.9)!important}
html.lap.lap-tt #page-timetable .tt-blk.study.done{opacity:.5}
html.lap.lap-tt #page-timetable .tt-blk.busy{background:repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 8px,rgba(255,255,255,.035) 8px 16px)!important;color:#a9a3d6!important;box-shadow:none!important;opacity:1!important}
html.lap.lap-tt #page-timetable .tt-blk.busy small{color:#8c86b8!important}
html.lap.lap-tt #page-timetable .tt-blk.free{background:transparent!important;border:1.5px dashed rgba(52,224,161,.22)!important;color:#7ee8c0!important;box-shadow:none!important}
html.lap.lap-tt #page-timetable .tt-blk.ghost{background:rgba(255,214,90,.25)!important;border:2px dashed #ffd65a!important;color:#fff!important}
/* side panel */
#lapTTside{display:none}
html.lap.lap-tt #lapTTside{display:flex;flex-direction:column;gap:16px}
.ltt-card{border-radius:24px;padding:18px;background:rgba(26,16,72,.86);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);color:#fff}
.ltt-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.ltt-h h2{font-size:18px;margin:0;color:#fff}
#lapTTside .ltt-h b{color:#ffd65a}
.ltt-it{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:14px;background:rgba(255,255,255,.07);color:#fff;text-align:left;margin-bottom:8px;font-family:inherit;cursor:pointer}
.ltt-it:hover{background:rgba(255,255,255,.13)}
.ltt-it.done{background:rgba(52,224,161,.15)}
.ltt-it.done b{text-decoration:line-through;opacity:.7}
.ltt-ic{width:38px;height:38px;flex:none;border-radius:12px;display:grid;place-items:center;font-size:19px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
.ltt-it span.t{flex:1;min-width:0}
.ltt-it span.t b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ltt-it span.t small{color:#bdb7e8;font-size:12.5px}
.ltt-due{padding:4px 10px;border-radius:999px;color:#16142e;font-weight:800;font-size:12.5px;white-space:nowrap}
.ltt-empty{color:#bdb7e8;font-size:14px;margin:0 0 6px}
.ltt-add{width:100%;height:42px;margin-top:4px;border:0;border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font-weight:800;font-family:inherit;cursor:pointer}
.ltt-add:hover{background:rgba(255,255,255,.18)}
.ltt-it:focus-visible,.ltt-add:focus-visible{outline:3px solid #ffd65a;outline-offset:2px}
html.lap.lap-tt #page-timetable .tt-hero2 .tt-h2top small{color:#d9d6ff!important}
html.lap.lap-tt #dateLabel{color:#cfc8ff!important}
html.lap.lap-tt #page-timetable .tt-next small{color:#5b5878!important}
html.lap.lap-tt #page-timetable .tt-next b{color:#16142e!important}
html.lap.lap-tt #page-timetable .tt-hero2 .tt-hl{background:rgba(255,255,255,.16)!important;color:#fff!important;border:0!important;border-radius:14px!important}
`;

  function D() { try { var d = (0, eval)('typeof data!=="undefined"?data:null'); return d || window.data || {}; } catch (e) { return window.data || {}; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function iso(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
  function t12(hm) { var p = String(hm || '').split(':'), h = +p[0], m = +p[1] || 0; if (isNaN(h)) return ''; return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); }
  var EMO = [['busin', '💼'], ['econ', '💹'], ['account', '🧾'], ['math', '➗'], ['english', '📖'], ['lit', '📖'], ['science', '🧪'], ['bio', '🧬'], ['chem', '⚗️'], ['phys', '🧲'], ['hist', '🏛️'], ['geo', '🌍'], ['comput', '💻'], ['art', '🎨'], ['music', '🎵'], ['french', '🇫🇷'], ['spanish', '🇪🇸'], ['hindi', '🇮🇳'], ['review', '🃏'], ['flash', '🃏'], ['quest', '🐉']];
  var COL = ['#ff8a4c', '#38c7ff', '#c084fc', '#34e0a1', '#ff6f9a', '#ffcf4d', '#7c8cff', '#f472b6'];
  function emo(s) { s = String(s || '').toLowerCase(); for (var i = 0; i < EMO.length; i++) if (s.indexOf(EMO[i][0]) >= 0) return EMO[i][1]; return '📘'; }
  function col(s) { var t = 0; String(s || 'x').split('').forEach(function (c) { t = t * 31 + c.charCodeAt(0) >>> 0; }); return COL[t % COL.length]; }

  function renderSide() {
    if (!side) return;
    var T = D().timetable || {}, today = iso(new Date());
    var plan = (T.plan || []).filter(function (p) { return p && p.date === today; }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    var done = plan.filter(function (p) { return p.done; }).length;
    var tasks = (T.tasks || []).filter(function (t) { return t && !t.done && t.due; }).sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); }).slice(0, 5);
    var h = '<section class="ltt-card" aria-label="Today"><div class="ltt-h"><h2>Today</h2>' + (plan.length ? '<b>' + done + ' / ' + plan.length + '</b>' : '') + '</div>' +
      (plan.length ? plan.slice(0, 6).map(function (p) {
        var c = col(p.subject);
        return '<button type="button" class="ltt-it' + (p.done ? ' done' : '') + '" data-sid="' + esc(p.id) + '"><span class="ltt-ic" style="background:' + c + '">' + (p.done ? '✅' : emo(p.subject + ' ' + p.title)) + '</span><span class="t"><b>' + esc(p.title) + '</b><small>' + t12(p.start) + (p.subject ? ' · ' + esc(p.subject) : '') + '</small></span></button>';
      }).join('') : '<p class="ltt-empty">Nothing planned for today yet.</p>') + '</section>' +
      '<section class="ltt-card" aria-label="Homework due"><div class="ltt-h"><h2>Homework due</h2></div>' +
      (tasks.length ? tasks.map(function (t) {
        var dd = new Date(t.due + 'T00:00:00'), diff = Math.round((dd - new Date(today + 'T00:00:00')) / 864e5);
        var lbl = isNaN(diff) ? '' : diff < 0 ? 'Late' : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : dd.toLocaleDateString('en-GB', { weekday: 'short' });
        return '<div class="ltt-it" style="cursor:default"><span class="ltt-ic" style="background:' + col(t.subject) + '">' + emo(t.subject + ' ' + t.title) + '</span><span class="t"><b>' + esc(t.title) + '</b><small>' + esc(t.subject || '') + (t.mins ? ' · ' + t.mins + ' min' : '') + '</small></span><span class="ltt-due" style="background:' + (diff <= 1 ? '#ffd65a' : col(t.subject)) + '">' + lbl + '</span></div>';
      }).join('') : '<p class="ltt-empty">No homework added.</p>') +
      '<button type="button" class="ltt-add" data-ltt="hw">+ Add homework</button></section>';
    if (h === lastSide) return; lastSide = h; side.innerHTML = h;
  }

  function markToday() {
    var t = iso(new Date());
    document.querySelectorAll('#ttCal .tt-col').forEach(function (c) { c.classList.toggle('lap-today', c.getAttribute('data-date') === t); });
  }

  function onSide(e) {
    var a = e.target.closest('[data-ltt="hw"]');
    if (a) { var tabs = document.querySelectorAll('#page-timetable .tt-tabs button'); var hw = Array.prototype.filter.call(tabs, function (b) { return /homework/i.test(b.textContent); })[0]; if (hw) { hw.click(); hw.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
    var s = e.target.closest('[data-sid]');
    if (s) { var blk = document.querySelector('#ttCal .tt-blk[data-sid="' + (window.CSS && CSS.escape ? CSS.escape(s.dataset.sid) : s.dataset.sid) + '"]'); if (blk) { blk.scrollIntoView({ behavior: 'smooth', block: 'center' }); blk.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 500, iterations: 2 }); } }
  }

  function sync() {
    var p = document.getElementById('page-timetable'), dp = document.getElementById('page-director');
    var on = root.classList.contains('lap') && !!((p && p.classList.contains('active')) || (dp && dp.classList.contains('active')));
    if (root.classList.contains('lap-tt') !== on) root.classList.toggle('lap-tt', on);
    if (on) { markToday(); renderSide(); }
  }

  function init() {
    var p = document.getElementById('page-timetable');
    if (!p) return setTimeout(init, 300);
    var st = document.createElement('style'); st.id = 'lapTTCss'; st.textContent = CSS; document.head.appendChild(st);
    side = document.createElement('aside'); side.id = 'lapTTside'; side.setAttribute('aria-label', 'Today and homework');
    side.addEventListener('click', onSide);
    p.appendChild(side);
    new MutationObserver(sync).observe(p, { attributes: true, attributeFilter: ['class'] });
    var dp = document.getElementById('page-director'); if (dp) new MutationObserver(sync).observe(dp, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(function () { if (root.classList.contains('lap-tt')) { clearTimeout(init.t); init.t = setTimeout(function () { markToday(); renderSide(); }, 80); } }).observe(p, { childList: true, subtree: true });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
