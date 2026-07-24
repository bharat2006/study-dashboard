/* ============================== FIREBASE SETUP ============================== */
/* Paste your Firebase project's config object here (Project settings → your apps → Web app). */
// This page loads the Firebase "compat" SDKs via <script> tags above, so we use
// the firebase.* global API here (NOT the "import ... from 'firebase/app'" modular
// syntax — that only works with a bundler or <script type="module">, and will
// silently crash a plain <script> block, which is what was causing the black page).

const firebaseConfig = {
  apiKey: "AIzaSyAvxzd5PslUQwrjxW3-CRtmQgrvP1WaXq0",
  authDomain: "study-tracker-854e6.firebaseapp.com",
  projectId: "study-tracker-854e6",
  storageBucket: "study-tracker-854e6.firebasestorage.app",
  messagingSenderId: "221640201465",
  appId: "1:221640201465:web:4864eefbd989489382fe28",
  measurementId: "G-EHEBTR92WQ"
};

const FIREBASE_NOT_CONFIGURED = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_");

let auth, db;
if(!FIREBASE_NOT_CONFIGURED){
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
}

/* ============================== DATA LAYER ============================== */
const PALETTE = ['#39D6E8','#FFB020','#FF6B5E','#8B7FE8','#5FDB8F','#E85FA8','#5FA8DB','#E8C15F'];

let subjects = [];
let entries = [];
let storageOK = true;
let currentUid = null;

function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }
function todayStr(){ return fmtDate(new Date()); }
function fmtDate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseDate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y, m-1, d); }
function minutesToLabel(min){
  min = Math.round(min);
  if(min <= 0) return '0m';
  const h = Math.floor(min/60), m = min%60;
  if(h===0) return `${m}m`;
  if(m===0) return `${h}h`;
  return `${h}h ${m}m`;
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>t.classList.remove('show'), 2200);
}

function userDoc(name){ return db.collection('users').doc(currentUid).collection('data').doc(name); }

async function loadAll(){
  try{
    const sDoc = await userDoc('subjects').get();
    subjects = sDoc.exists ? (sDoc.data().list || []) : [];
  }catch(e){ subjects = []; storageOK = false; }
  try{
    const eDoc = await userDoc('entries').get();
    entries = eDoc.exists ? (eDoc.data().list || []) : [];
  }catch(e){ entries = []; storageOK = false; }

  if(subjects.length === 0){
    subjects = [{ id: uid(), name:'Terraform', category:'Cloud & DevOps', color: PALETTE[0] }];
    await saveSubjects();
  }
}
async function saveSubjects(){
  try{ await userDoc('subjects').set({ list: subjects }); storageOK = true; }
  catch(e){ storageOK = false; showToast('Sync error — check your connection'); }
}
async function saveEntries(){
  try{ await userDoc('entries').set({ list: entries }); storageOK = true; }
  catch(e){ storageOK = false; showToast('Sync error — check your connection'); }
}

function cssVar(name){ return getComputedStyle(document.body).getPropertyValue(name).trim(); }

function subjectById(id){ return subjects.find(s=>s.id===id); }
function entriesOnDate(dateStr){ return entries.filter(e=>e.date===dateStr); }
function entriesInRange(startStr, endStr){ return entries.filter(e=> e.date >= startStr && e.date <= endStr); }


/* aggregate: returns {bySubject: {id: minutes}, total, byType:{Study,Lab}, activeDays:Set} */
function aggregate(list){
  const bySubject = {}; let total = 0; const byType = {Study:0, Lab:0, Other:0}; const activeDays = new Set();
  list.forEach(e=>{
    bySubject[e.subjectId] = (bySubject[e.subjectId]||0) + e.minutes;
    total += e.minutes;
    byType[e.type] = (byType[e.type]||0) + e.minutes;
    activeDays.add(e.date);
  });
  return { bySubject, total, byType, activeDays };
}

/* ============================== NAV / ROUTER ============================== */
const pages = ['dashboard','log','subjects','calendar','weekly','monthly','raw'];
function goTo(page){
  pages.forEach(p=>{
    document.getElementById('page-'+p).classList.toggle('hidden', p!==page);
  });
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.page===page));
  renderPage(page);
}
document.getElementById('nav').addEventListener('click', (e)=>{
  const item = e.target.closest('.nav-item');
  if(item) goTo(item.dataset.page);
});

function renderPage(page){
  if(page==='dashboard') renderDashboard();
  if(page==='log') renderLogPage();
  if(page==='subjects') renderSubjectsPage();
  if(page==='calendar') renderCalendarPage();
  if(page==='weekly') renderWeeklyPage();
  if(page==='monthly') renderMonthlyPage();
  if(page==='raw') renderRawPage();
  document.getElementById('entryCountFoot').textContent = `${entries.length} entries`;
}

/* ============================== SHARED WIDGETS ============================== */
function subjectSelectOptions(selectedId){
  if(subjects.length===0) return `<option value="">No subjects yet</option>`;
  return subjects.map(s=>`<option value="${s.id}" ${s.id===selectedId?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
}
function escapeHtml(str){
  const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML;
}
function colorSwatchPicker(containerId, selectedColor){
  return `<div class="pill-input-row" id="${containerId}">` +
    PALETTE.map(c=>`<div class="color-dot-btn ${c===selectedColor?'sel':''}" data-color="${c}" style="background:${c};"></div>`).join('') +
  `</div>`;
}

function effortBars(container, bySubjectMinutes, total){
  if(total <= 0){
    container.innerHTML = `<div class="empty-state"><div class="big">◌</div>No time logged for this period yet.<br>Add an entry to see effort % by subject.</div>`;
    return;
  }
  const rows = subjects.map(s=>{
    const min = bySubjectMinutes[s.id] || 0;
    const pct = total>0 ? (min/total*100) : 0;
    return {s, min, pct};
  }).filter(r=>r.min>0).sort((a,b)=>b.min-a.min);
  if(rows.length===0){
    container.innerHTML = `<div class="empty-state"><div class="big">◌</div>No time logged for this period yet.</div>`;
    return;
  }
  container.innerHTML = rows.map(r=>`
    <div class="bar-row">
      <div class="bar-top">
        <span class="name"><span class="swatch" style="background:${r.s.color};"></span>${escapeHtml(r.s.name)}</span>
        <span class="pct">${r.pct.toFixed(1)}% · ${minutesToLabel(r.min)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${r.pct}%; background:${r.s.color};"></div></div>
    </div>
  `).join('');
}

/* ============================== DASHBOARD ============================== */
function renderDashboard(){
  const now = new Date();
  document.getElementById('todayChip').textContent = now.toLocaleDateString(undefined, {weekday:'long', year:'numeric', month:'long', day:'numeric'});

  const today = todayStr();
  const todayAgg = aggregate(entriesOnDate(today));
  const todayValEl = document.getElementById('statTodayTime');
  const todayDeltaEl = document.getElementById('statTodayDelta');
  if(todayAgg.total > 0){
    todayValEl.textContent = minutesToLabel(todayAgg.total);
    todayValEl.className = 'stat-value cyan';
    todayValEl.style.color = '';
    todayDeltaEl.textContent = `${Object.keys(todayAgg.bySubject).length} subject(s) logged`;
    todayDeltaEl.className = 'stat-delta';
  } else {
    todayValEl.textContent = '0%';
    todayValEl.className = 'stat-value';
    todayValEl.style.color = 'var(--coral)';
    todayDeltaEl.textContent = 'no study or lab time logged yet today';
    todayDeltaEl.className = 'stat-delta down';
  }

  // streak
  let streak = 0; let d = new Date();
  while(true){
    const ds = fmtDate(d);
    if(entriesOnDate(ds).length>0){ streak++; d.setDate(d.getDate()-1); } else break;
  }
  document.getElementById('statStreak').textContent = `${streak} day${streak!==1?'s':''}`;

  // this week vs last week
  const {start: wkStart, end: wkEnd} = weekRange(now);
  const lastWkStart = new Date(wkStart); lastWkStart.setDate(lastWkStart.getDate()-7);
  const lastWkEnd = new Date(wkEnd); lastWkEnd.setDate(lastWkEnd.getDate()-7);
  const thisWeekAgg = aggregate(entriesInRange(fmtDate(wkStart), fmtDate(wkEnd)));
  const lastWeekAgg = aggregate(entriesInRange(fmtDate(lastWkStart), fmtDate(lastWkEnd)));
  document.getElementById('statWeekTime').textContent = minutesToLabel(thisWeekAgg.total);
  const delta = thisWeekAgg.total - lastWeekAgg.total;
  const deltaEl = document.getElementById('statWeekDelta');
  if(lastWeekAgg.total===0 && thisWeekAgg.total===0){ deltaEl.textContent = 'vs last week: no data'; deltaEl.className='stat-delta'; }
  else{
    deltaEl.textContent = `${delta>=0?'+':''}${minutesToLabel(Math.abs(delta))} vs last week`;
    deltaEl.className = 'stat-delta ' + (delta>0?'up': delta<0?'down':'');
  }

  document.getElementById('statSubjectCount').textContent = subjects.length;

  effortBars(document.getElementById('todayEffortBars'), todayAgg.bySubject, todayAgg.total);

  // quick log form
  const qf = document.getElementById('quickLogForm');
  qf.innerHTML = `
    <div class="form-grid">
      <div><label>Subject</label><select id="qSubject">${subjectSelectOptions()}</select></div>
      <div><label>Type</label><select id="qType"><option>Study</option><option>Lab</option><option>Other</option></select></div>
      <div><label>Minutes</label><input type="number" id="qMinutes" min="1" placeholder="e.g. 90"></div>
      <div><label>Notes (optional)</label><input type="text" id="qNotes" placeholder="e.g. modules & state"></div>
      <div><button id="qAddBtn" style="width:100%;">+ Add for Today</button></div>
    </div>`;
  document.getElementById('qAddBtn').onclick = async ()=>{
    const subjectId = document.getElementById('qSubject').value;
    const type = document.getElementById('qType').value;
    const minutes = parseFloat(document.getElementById('qMinutes').value);
    const notes = document.getElementById('qNotes').value.trim();
    if(!subjectId){ showToast('Add a subject first in Subject Master'); return; }
    if(!minutes || minutes<=0){ showToast('Enter minutes spent'); return; }
    entries.push({ id: uid(), date: today, subjectId, type, minutes, notes });
    await saveEntries();
    showToast('Entry added ✓');
    renderDashboard();
  };

  // last 7 days strip
  const strip = document.getElementById('last7Strip');
  let html = '<div class="grid" style="grid-template-columns:repeat(7,1fr); gap:8px;">';
  for(let i=6;i>=0;i--){
    const dd = new Date(); dd.setDate(dd.getDate()-i);
    const ds = fmtDate(dd);
    const agg = aggregate(entriesOnDate(ds));
    const zero = agg.total===0;
    html += `<div style="text-align:center; padding:10px 4px; border-radius:8px; border:1px solid var(--border); background:${zero?'transparent':'rgba(57,214,232,0.06)'};">
      <div style="font-family:var(--font-mono); font-size:9.5px; color:var(--text-low); text-transform:uppercase;">${dd.toLocaleDateString(undefined,{weekday:'short'})}</div>
      <div style="font-family:var(--font-mono); font-size:14px; font-weight:700; margin-top:4px; color:${zero?'var(--coral)':'var(--cyan)'};">${zero?'0%':minutesToLabel(agg.total)}</div>
    </div>`;
  }
  html += '</div>';
  strip.innerHTML = html;
}
function weekRange(date){
  const d = new Date(date); const day = d.getDay(); // 0=Sun
  const diffToMon = (day===0?-6:1-day);
  const start = new Date(d); start.setDate(d.getDate()+diffToMon); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+6);
  return {start, end};
}

/* ============================== DAILY LOG PAGE ============================== */
let logSelectedDate = todayStr();
function renderLogPage(){
  const lf = document.getElementById('logForm');
  lf.innerHTML = `
    <div class="form-grid">
      <div><label>Date</label><input type="date" id="lDate" value="${logSelectedDate}"></div>
      <div><label>Subject</label><select id="lSubject">${subjectSelectOptions()}</select></div>
      <div><label>Type</label><select id="lType"><option>Study</option><option>Lab</option><option>Other</option></select></div>
      <div><label>Minutes</label><input type="number" id="lMinutes" min="1" placeholder="e.g. 30"></div>
      <div><label>Notes</label><input type="text" id="lNotes" placeholder="optional"></div>
    </div>
    <div style="margin-top:12px;"><button id="lAddBtn">+ Add Entry</button></div>
  `;
  document.getElementById('lAddBtn').onclick = async ()=>{
    const date = document.getElementById('lDate').value || todayStr();
    const subjectId = document.getElementById('lSubject').value;
    const type = document.getElementById('lType').value;
    const minutes = parseFloat(document.getElementById('lMinutes').value);
    const notes = document.getElementById('lNotes').value.trim();
    if(!subjectId){ showToast('Add a subject first in Subject Master'); return; }
    if(!minutes || minutes<=0){ showToast('Enter minutes spent'); return; }
    entries.push({ id: uid(), date, subjectId, type, minutes, notes });
    await saveEntries();
    logSelectedDate = date;
    showToast('Entry added ✓');
    renderLogPage();
  };

  document.getElementById('logDateFilter').value = logSelectedDate;
  document.getElementById('logDateFilter').onchange = (e)=>{ logSelectedDate = e.target.value; renderLogPage(); };
  const label = new Date(logSelectedDate+'T00:00:00');
  document.getElementById('logDateLabel').textContent = label.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'});

  const dayEntries = entriesOnDate(logSelectedDate);
  const agg = aggregate(dayEntries);
  const tbl = document.getElementById('logDayTable');
  if(dayEntries.length===0){
    tbl.innerHTML = `<div class="empty-state"><div class="big">◌</div>No entries for this day — showing as <b style="color:var(--coral);">0%</b> effort across all subjects.</div>`;
    return;
  }
  tbl.innerHTML = `
    <table>
      <thead><tr><th>Subject</th><th>Type</th><th>Duration</th><th>Effort %</th><th>Notes</th><th></th></tr></thead>
      <tbody>
      ${dayEntries.map(e=>{
        const s = subjectById(e.subjectId);
        const pct = agg.total>0 ? (e.minutes/agg.total*100).toFixed(1) : '0.0';
        return `<tr>
          <td><span class="tag"><span class="swatch" style="background:${s?s.color:'#666'};"></span>${escapeHtml(s?s.name:'Deleted subject')}</span></td>
          <td>${e.type}</td>
          <td style="font-family:var(--font-mono);">${minutesToLabel(e.minutes)}</td>
          <td style="font-family:var(--font-mono); color:var(--cyan);">${pct}%</td>
          <td style="color:var(--text-mid);">${escapeHtml(e.notes||'—')}</td>
          <td><button class="danger" data-id="${e.id}">DELETE</button></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
  tbl.querySelectorAll('button[data-id]').forEach(b=>{
    b.onclick = async ()=>{
      entries = entries.filter(e=>e.id!==b.dataset.id);
      await saveEntries();
      showToast('Entry removed');
      renderLogPage();
    };
  });
}

/* ============================== SUBJECT MASTER ============================== */
let pickedColor = PALETTE[0];
function renderSubjectsPage(){
  const sf = document.getElementById('subjectForm');
  sf.innerHTML = `
    <div class="form-grid" style="grid-template-columns:2fr 2fr 2fr 1fr;">
      <div><label>Subject Name</label><input type="text" id="sName" placeholder="e.g. Terraform"></div>
      <div><label>Category</label><input type="text" id="sCategory" placeholder="e.g. Cloud & DevOps"></div>
      <div><label>Color</label>${colorSwatchPicker('sColorPicker', pickedColor)}</div>
      <div><button id="sAddBtn" style="width:100%;">+ Add Subject</button></div>
    </div>`;
  document.querySelectorAll('#sColorPicker .color-dot-btn').forEach(btn=>{
    btn.onclick = ()=>{ pickedColor = btn.dataset.color; document.querySelectorAll('#sColorPicker .color-dot-btn').forEach(b=>b.classList.remove('sel')); btn.classList.add('sel'); };
  });
  document.getElementById('sAddBtn').onclick = async ()=>{
    const name = document.getElementById('sName').value.trim();
    const category = document.getElementById('sCategory').value.trim() || 'General';
    if(!name){ showToast('Enter a subject name'); return; }
    if(subjects.some(s=>s.name.toLowerCase()===name.toLowerCase())){ showToast('Subject already exists'); return; }
    subjects.push({ id: uid(), name, category, color: pickedColor });
    await saveSubjects();
    showToast('Subject added ✓');
    renderSubjectsPage();
  };

  const st = document.getElementById('subjectTable');
  if(subjects.length===0){
    st.innerHTML = `<div class="empty-state"><div class="big">◌</div>No subjects yet. Add your first topic above.</div>`;
    return;
  }
  st.innerHTML = `
    <table>
      <thead><tr><th>Subject</th><th>Category</th><th>Total Logged</th><th>Entries</th><th></th></tr></thead>
      <tbody>
      ${subjects.map(s=>{
        const subEntries = entries.filter(e=>e.subjectId===s.id);
        const total = subEntries.reduce((a,e)=>a+e.minutes,0);
        return `<tr>
          <td><span class="tag"><span class="swatch" style="background:${s.color};"></span>${escapeHtml(s.name)}</span></td>
          <td style="color:var(--text-mid);">${escapeHtml(s.category)}</td>
          <td style="font-family:var(--font-mono);">${minutesToLabel(total)}</td>
          <td style="font-family:var(--font-mono);">${subEntries.length}</td>
          <td><button class="danger" data-id="${s.id}">DELETE</button></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
  st.querySelectorAll('button[data-id]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Delete this subject? Its logged entries will remain but show as "Deleted subject".')) return;
      subjects = subjects.filter(s=>s.id!==b.dataset.id);
      await saveSubjects();
      showToast('Subject deleted');
      renderSubjectsPage();
    };
  });
}

/* ============================== CALENDAR HEATMAP ============================== */
let calCursor = new Date();
function renderCalendarPage(){
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  document.getElementById('calMonthLabel').textContent = calCursor.toLocaleDateString(undefined,{month:'long', year:'numeric'});
  const grid = document.getElementById('calGrid');
  const firstDay = new Date(y, m, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();

  // find max minutes in month for intensity scaling
  let maxMin = 0;
  for(let day=1; day<=daysInMonth; day++){
    const ds = fmtDate(new Date(y,m,day));
    const t = aggregate(entriesOnDate(ds)).total;
    if(t>maxMin) maxMin = t;
  }

  let html = ['S','M','T','W','T','F','S'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<startOffset;i++) html += `<div class="cal-cell empty"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const dateObj = new Date(y,m,day);
    const ds = fmtDate(dateObj);
    const agg = aggregate(entriesOnDate(ds));
    const intensity = maxMin>0 ? agg.total/maxMin : 0;
    let bg = 'var(--bg-void)';
    if(agg.total>0){
      const alpha = 0.15 + intensity*0.7;
      bg = `rgba(57,214,232,${alpha.toFixed(2)})`;
    }
    const isToday = ds===todayStr();
    const pct = 0; // per-day pct shown in detail panel
    html += `<div class="cal-cell ${isToday?'today':''}" style="background:${bg};" data-date="${ds}">
      <div class="d">${day}</div>
      <div class="m" style="color:${agg.total>0?'#04141A':'var(--text-low)'};">${agg.total>0?minutesToLabel(agg.total):'0%'}</div>
    </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell=>{
    cell.onclick = ()=> showDayDetail(cell.dataset.date);
  });
}
function showDayDetail(ds){
  const panel = document.getElementById('calDayDetail');
  const dayEntries = entriesOnDate(ds);
  const agg = aggregate(dayEntries);
  const label = new Date(ds+'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'});
  if(dayEntries.length===0){
    panel.innerHTML = `<h3 class="section-h">${label}</h3><div class="empty-state"><div class="big">◌</div>No study or lab activity logged. Effort = <b style="color:var(--coral);">0%</b> across all subjects.</div>`;
    return;
  }
  panel.innerHTML = `<h3 class="section-h">${label} — Total ${minutesToLabel(agg.total)}</h3><div id="calDetailBars"></div>`;
  effortBars(document.getElementById('calDetailBars'), agg.bySubject, agg.total);
}
document.getElementById('calPrev').onclick = ()=>{ calCursor.setMonth(calCursor.getMonth()-1); renderCalendarPage(); };
document.getElementById('calNext').onclick = ()=>{ calCursor.setMonth(calCursor.getMonth()+1); renderCalendarPage(); };
document.getElementById('calToday').onclick = ()=>{ calCursor = new Date(); renderCalendarPage(); };

/* ============================== WEEKLY ANALYTICS ============================== */
let weekCursor = new Date();
let wkPieChart, wkBarChartInst;
function renderWeeklyPage(){
  const {start, end} = weekRange(weekCursor);
  document.getElementById('weekLabel').textContent = `${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric', year:'numeric'})}`;
  const list = entriesInRange(fmtDate(start), fmtDate(end));
  const agg = aggregate(list);

  document.getElementById('wkTotal').textContent = minutesToLabel(agg.total);
  document.getElementById('wkActiveDays').textContent = `${agg.activeDays.size} / 7`;
  document.getElementById('wkStudy').textContent = minutesToLabel(agg.byType.Study||0);
  document.getElementById('wkLab').textContent = minutesToLabel(agg.byType.Lab||0);

  effortBars(document.getElementById('wkBars'), agg.bySubject, agg.total);

  // pie chart
  const pieData = subjects.map(s=>agg.bySubject[s.id]||0);
  const pieLabels = subjects.map(s=>s.name);
  const pieColors = subjects.map(s=>s.color);
  if(wkPieChart) wkPieChart.destroy();
  wkPieChart = new Chart(document.getElementById('wkPie'), {
    type:'doughnut',
    data:{ labels: pieLabels, datasets:[{ data: pieData, backgroundColor: pieColors, borderColor: cssVar('--bg-panel'), borderWidth:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:cssVar('--text-mid'), font:{family:'JetBrains Mono', size:10}, boxWidth:10 } } } }
  });

  // daily bar chart mon-sun
  const days = []; const dayLabels = [];
  for(let i=0;i<7;i++){ const d=new Date(start); d.setDate(start.getDate()+i); days.push(fmtDate(d)); dayLabels.push(d.toLocaleDateString(undefined,{weekday:'short'})); }
  const dayTotals = days.map(ds=>aggregate(entriesOnDate(ds)).total);
  if(wkBarChartInst) wkBarChartInst.destroy();
  wkBarChartInst = new Chart(document.getElementById('wkBarChart'), {
    type:'bar',
    data:{ labels: dayLabels, datasets:[{ label:'Minutes', data: dayTotals, backgroundColor: dayTotals.map(v=>v>0?cssVar('--cyan'):'rgba(255,107,94,0.25)'), borderRadius:4 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{ ticks:{ color:cssVar('--text-mid'), font:{family:'JetBrains Mono', size:10} }, grid:{ color:cssVar('--grid-line')} },
                y:{ ticks:{ color:cssVar('--text-mid'), font:{family:'JetBrains Mono', size:10} }, grid:{ color:cssVar('--grid-line')} } } }
  });

  renderMissedDays(document.getElementById('wkMissed'), days, agg.activeDays);
}
document.getElementById('weekPrev').onclick = ()=>{ weekCursor.setDate(weekCursor.getDate()-7); renderWeeklyPage(); };
document.getElementById('weekNext').onclick = ()=>{ weekCursor.setDate(weekCursor.getDate()+7); renderWeeklyPage(); };

/* ============================== MONTHLY ANALYTICS ============================== */
let moCursor = new Date();
let moPieChart, moTrendChartInst;
function renderMonthlyPage(){
  const y = moCursor.getFullYear(), m = moCursor.getMonth();
  document.getElementById('moLabel').textContent = moCursor.toLocaleDateString(undefined,{month:'long', year:'numeric'});
  const start = fmtDate(new Date(y,m,1));
  const daysInMonth = new Date(y,m+1,0).getDate();
  const end = fmtDate(new Date(y,m,daysInMonth));
  const list = entriesInRange(start, end);
  const agg = aggregate(list);

  document.getElementById('moTotal').textContent = minutesToLabel(agg.total);
  document.getElementById('moActiveDays').textContent = `${agg.activeDays.size} / ${daysInMonth}`;
  document.getElementById('moStudy').textContent = minutesToLabel(agg.byType.Study||0);
  document.getElementById('moLab').textContent = minutesToLabel(agg.byType.Lab||0);

  effortBars(document.getElementById('moBars'), agg.bySubject, agg.total);

  const pieData = subjects.map(s=>agg.bySubject[s.id]||0);
  const pieLabels = subjects.map(s=>s.name);
  const pieColors = subjects.map(s=>s.color);
  if(moPieChart) moPieChart.destroy();
  moPieChart = new Chart(document.getElementById('moPie'), {
    type:'doughnut',
    data:{ labels: pieLabels, datasets:[{ data: pieData, backgroundColor: pieColors, borderColor: cssVar('--bg-panel'), borderWidth:2 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:cssVar('--text-mid'), font:{family:'JetBrains Mono', size:10}, boxWidth:10 } } } }
  });

  // weekly trend within month
  const weekBuckets = []; let cursor = new Date(y,m,1);
  while(cursor.getMonth()===m){
    const {start:ws, end:we} = weekRange(cursor);
    const label = `${ws.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
    const wtotal = aggregate(entriesInRange(fmtDate(ws), fmtDate(we))).total;
    if(!weekBuckets.some(w=>w.label===label)) weekBuckets.push({label, total: wtotal});
    cursor.setDate(cursor.getDate()+7);
  }
  if(moTrendChartInst) moTrendChartInst.destroy();
  moTrendChartInst = new Chart(document.getElementById('moTrendChart'), {
    type:'line',
    data:{ labels: weekBuckets.map(w=>w.label), datasets:[{ label:'Minutes / week', data: weekBuckets.map(w=>w.total), borderColor: cssVar('--cyan'), backgroundColor:'rgba(57,214,232,0.15)', fill:true, tension:0.3, pointBackgroundColor: cssVar('--cyan') }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{ ticks:{ color:cssVar('--text-mid'), font:{family:'JetBrains Mono', size:10} }, grid:{ color:cssVar('--grid-line')} },
                y:{ ticks:{ color:cssVar('--text-mid'), font:{family:'JetBrains Mono', size:10} }, grid:{ color:cssVar('--grid-line')} } } }
  });

  const monthDays = []; for(let day=1; day<=daysInMonth; day++) monthDays.push(fmtDate(new Date(y,m,day)));
  renderMissedDays(document.getElementById('moMissed'), monthDays, agg.activeDays);
}

/* list of dates in `allDays` that have zero logged minutes (excludes future dates) */
function renderMissedDays(container, allDays, activeDaysSet){
  if(!container) return;
  const today = todayStr();
  const missed = allDays.filter(ds => ds <= today && !activeDaysSet.has(ds));
  if(missed.length === 0){
    container.innerHTML = `<div class="empty-state" style="padding:18px;"><div class="big">✓</div>No missed days in this period — nice consistency.</div>`;
    return;
  }
  container.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fill, minmax(90px,1fr)); gap:8px;">` +
    missed.map(ds=>{
      const d = new Date(ds+'T00:00:00');
      return `<div style="text-align:center; padding:9px 4px; border-radius:8px; border:1px solid rgba(255,107,94,0.3); background:rgba(255,107,94,0.06);">
        <div style="font-family:var(--font-mono); font-size:9.5px; color:var(--text-low);">${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div>
        <div style="font-family:var(--font-mono); font-size:12px; font-weight:700; color:var(--coral); margin-top:3px;">0%</div>
      </div>`;
    }).join('') + `</div>`;
}
document.getElementById('moPrev').onclick = ()=>{ moCursor.setMonth(moCursor.getMonth()-1); renderMonthlyPage(); };
document.getElementById('moNext').onclick = ()=>{ moCursor.setMonth(moCursor.getMonth()+1); renderMonthlyPage(); };

/* ============================== RAW DATA ============================== */
function renderRawPage(){
  const filterSel = document.getElementById('rawSubjectFilter');
  filterSel.innerHTML = `<option value="">All subjects</option>` + subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  filterSel.onchange = ()=> renderRawTable(filterSel.value);
  renderRawTable('');

  document.getElementById('exportCsv').onclick = ()=>{
    if(entries.length===0){ showToast('No data to export'); return; }
    const rows = [['Date','Subject','Category','Type','Minutes','Notes']];
    entries.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>{
      const s = subjectById(e.subjectId);
      rows.push([e.date, s?s.name:'Deleted', s?s.category:'', e.type, e.minutes, (e.notes||'').replace(/,/g,';')]);
    });
    const csv = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'study_log_raw_data.csv'; a.click();
    URL.revokeObjectURL(url);
  };
}
function renderRawTable(filterSubjectId){
  const rt = document.getElementById('rawTable');
  let list = entries.slice().sort((a,b)=> b.date.localeCompare(a.date));
  if(filterSubjectId) list = list.filter(e=>e.subjectId===filterSubjectId);
  if(list.length===0){
    rt.innerHTML = `<div class="empty-state"><div class="big">◌</div>No entries to show yet. Start logging from the Daily Study Log page.</div>`;
    return;
  }
  rt.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Subject</th><th>Category</th><th>Type</th><th>Duration</th><th>Notes</th><th></th></tr></thead>
      <tbody>
      ${list.map(e=>{
        const s = subjectById(e.subjectId);
        return `<tr>
          <td style="font-family:var(--font-mono);">${e.date}</td>
          <td><span class="tag"><span class="swatch" style="background:${s?s.color:'#666'};"></span>${escapeHtml(s?s.name:'Deleted subject')}</span></td>
          <td style="color:var(--text-mid);">${escapeHtml(s?s.category:'—')}</td>
          <td>${e.type}</td>
          <td style="font-family:var(--font-mono);">${minutesToLabel(e.minutes)}</td>
          <td style="color:var(--text-mid);">${escapeHtml(e.notes||'—')}</td>
          <td><button class="danger" data-id="${e.id}">DELETE</button></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
  rt.querySelectorAll('button[data-id]').forEach(b=>{
    b.onclick = async ()=>{
      entries = entries.filter(e=>e.id!==b.dataset.id);
      await saveEntries();
      showToast('Entry removed');
      renderRawTable(filterSubjectId);
      document.getElementById('entryCountFoot').textContent = `${entries.length} entries`;
    };
  });
}

/* ============================== THEME ============================== */
async function loadTheme(){
  let theme = 'dark';
  try{ const t = await userDoc('theme').get(); if(t.exists) theme = t.data().value; }
  catch(e){ /* default dark */ }
  applyTheme(theme);
}
function applyTheme(theme){
  document.body.setAttribute('data-theme', theme);
  document.getElementById('themeToggleLabel').textContent = theme==='light' ? '☀️ Light mode' : '🌙 Dark mode';
  // refresh charts so their text colors match the new theme
  ['weekly','monthly'].forEach(p=>{
    if(!document.getElementById('page-'+p).classList.contains('hidden')) renderPage(p);
  });
}
document.getElementById('themeToggle').onclick = async ()=>{
  const current = document.body.getAttribute('data-theme') || 'dark';
  const next = current==='light' ? 'dark' : 'light';
  applyTheme(next);
  try{ await userDoc('theme').set({ value: next }); }
  catch(e){ showToast('Could not sync theme preference'); }
};

/* ============================== CLOCK ============================== */
function tickClock(){
  document.getElementById('clockFoot').textContent = new Date().toLocaleTimeString(undefined,{hour:'2-digit', minute:'2-digit'});
}
setInterval(tickClock, 1000*30);

/* ============================== AUTH ============================== */
let authMode = 'signin'; // 'signin' | 'signup'

function setAuthMode(mode){
  authMode = mode;
  document.getElementById('authModeLabel').textContent = mode==='signin' ? 'Sign in to your account' : 'Create your account';
  document.getElementById('authSubmitBtn').textContent = mode==='signin' ? 'Sign In' : 'Create Account';
  document.getElementById('authSwitchLine').innerHTML = mode==='signin'
    ? `New here? <a id="authSwitchLink">Create an account</a>`
    : `Already have an account? <a id="authSwitchLink">Sign in</a>`;
  document.getElementById('authError').textContent = '';
  document.getElementById('authSwitchLink').onclick = ()=> setAuthMode(mode==='signin' ? 'signup' : 'signin');
}

async function startApp(){
  await loadAll();
  await loadTheme();
  tickClock();
  document.getElementById('appSidebar').classList.remove('hidden');
  document.getElementById('appMain').classList.remove('hidden');
  const emailEl = document.getElementById('syncedEmail');
  emailEl.textContent = auth.currentUser.email;
  emailEl.title = auth.currentUser.email;
  goTo('dashboard');
}

(function initAuth(){
  if(FIREBASE_NOT_CONFIGURED){
    document.getElementById('setupOverlay').classList.remove('hidden');
    return;
  }

  setAuthMode('signin');
  document.getElementById('authSwitchLink').onclick = ()=> setAuthMode('signup');

  document.getElementById('authSubmitBtn').onclick = async ()=>{
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    errEl.textContent = '';
    if(!email || !password){ errEl.textContent = 'Enter both email and password.'; return; }
    try{
      if(authMode === 'signin'){
        await auth.signInWithEmailAndPassword(email, password);
      } else {
        await auth.createUserWithEmailAndPassword(email, password);
      }
    }catch(e){
      errEl.textContent = e.message.replace('Firebase: ','');
    }
  };

  document.getElementById('signOutLink').onclick = async ()=>{
    await auth.signOut();
  };

  auth.onAuthStateChanged(async (user)=>{
    if(user){
      currentUid = user.uid;
      document.getElementById('authOverlay').classList.add('hidden');
      await startApp();
    } else {
      currentUid = null;
      document.getElementById('appSidebar').classList.add('hidden');
      document.getElementById('appMain').classList.add('hidden');
      document.getElementById('authEmail').value = '';
      document.getElementById('authPassword').value = '';
      document.getElementById('authOverlay').classList.remove('hidden');
    }
  });
})();
