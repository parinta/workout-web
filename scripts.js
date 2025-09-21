// ===== IndexedDB (Dexie) 初期化 =====
const db = new Dexie('workout_db');
db.version(1).stores({
  workouts: '++id, date, exercise, weightKg, reps, sets' // index
});

// ===== UI要素 =====
const form = document.getElementById('entry-form');
const editId = document.getElementById('editId');
const dateEl = document.getElementById('date');
const exEl = document.getElementById('exercise');
const wEl = document.getElementById('weight');
const repsEl = document.getElementById('reps');
const setsEl = document.getElementById('sets');
const notesEl = document.getElementById('notes');
const listTbody = document.querySelector('#list tbody');
const filterExercise = document.getElementById('filterExercise');
const exerciseSelect = document.getElementById('exerciseSelect');

// タブ切替
const panels = {
  input: document.getElementById('panel-input'),
  charts: document.getElementById('panel-charts'),
  backup: document.getElementById('panel-backup'),
};
const tabs = {
  input: document.getElementById('tab-input'),
  charts: document.getElementById('tab-charts'),
  backup: document.getElementById('tab-backup'),
};
Object.entries(tabs).forEach(([key, btn])=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    panels[key].classList.add('active');
    if (key === 'charts') drawAllCharts();
  });
});

// 今日の日付を初期セット
dateEl.value = new Date().toISOString().slice(0,10);

// ===== 追加/更新 =====
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const data = {
    date: dateEl.value, // YYYY-MM-DD
    exercise: exEl.value.trim(),
    weightKg: parseFloat(wEl.value),
    reps: parseInt(repsEl.value,10),
    sets: parseInt(setsEl.value,10),
    notes: notesEl.value.trim()
  };
  if (!data.date || !data.exercise || isNaN(data.weightKg) || isNaN(data.reps) || isNaN(data.sets)) {
    alert('必須項目が未入力です'); return;
  }
  const id = editId.value ? parseInt(editId.value,10) : null;
  if (id) {
    await db.workouts.update(id, data);
  } else {
    await db.workouts.add(data);
  }
  clearForm();
  await refreshList();
  await refreshExerciseOptions();
});

document.getElementById('clearBtn').addEventListener('click', clearForm);
function clearForm(){
  editId.value = '';
  // 日付は残す
  exEl.value = '';
  wEl.value = '';
  repsEl.value = '';
  setsEl.value = '';
  notesEl.value = '';
  document.getElementById('saveBtn').textContent = '保存';
}

// ===== 一覧表示 =====
async function refreshList(){
  const q = filterExercise.value.trim().toLowerCase();
  let items = await db.workouts.toArray();
  items.sort((a,b)=> (a.date < b.date ? 1 : -1)); // 新しい順
  if (q) items = items.filter(r => r.exercise.toLowerCase().includes(q));
  listTbody.innerHTML = '';
  for (const r of items) {
    const vol = r.weightKg * r.reps * r.sets;
    const e1rm = r.weightKg * (1 + r.reps/30);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${escapeHtml(r.exercise)}</td>
      <td>${r.weightKg}</td>
      <td>${r.reps}</td>
      <td>${r.sets}</td>
      <td>${vol.toFixed(0)}</td>
      <td>${e1rm.toFixed(1)}</td>
      <td>${escapeHtml(r.notes||'')}</td>
      <td>
        <button data-edit="${r.id}">編集</button>
        <button data-del="${r.id}">削除</button>
      </td>
    `;
    listTbody.appendChild(tr);
  }
}
listTbody.addEventListener('click', async (e)=>{
  const t = e.target;
  if (t.dataset.edit){
    const r = await db.workouts.get(parseInt(t.dataset.edit,10));
    if (!r) return;
    editId.value = r.id;
    dateEl.value = r.date;
    exEl.value = r.exercise;
    wEl.value = r.weightKg;
    repsEl.value = r.reps;
    setsEl.value = r.sets;
    notesEl.value = r.notes || '';
    document.getElementById('saveBtn').textContent = '更新';
    tabs.input.click();
  } else if (t.dataset.del){
    if (confirm('削除しますか？')){
      await db.workouts.delete(parseInt(t.dataset.del,10));
      await refreshList();
      await refreshExerciseOptions();
    }
  }
});
filterExercise.addEventListener('input', refreshList);
document.getElementById('clearFilterBtn').addEventListener('click', ()=>{
  filterExercise.value = '';
  refreshList();
});

// ===== グラフ =====
let dailyChart, maxChart, rmChart;

async function computeSeries(){
  const all = await db.workouts.toArray();
  // 日付昇順
  all.sort((a,b)=> a.date.localeCompare(b.date));

  // 日次総ボリューム
  const daily = {};
  for (const r of all) {
    const vol = r.weightKg * r.reps * r.sets;
    daily[r.date] = (daily[r.date] || 0) + vol;
  }

  // 種目リスト
  const exSet = new Set(all.map(r => r.exercise));
  const exercises = Array.from(exSet).sort((a,b)=>a.localeCompare(b,'ja'));

  // 種目ごと系列（最大重量 / 最大e1RM）
  const perExercise = {};
  for (const ex of exercises) {
    const g = all.filter(r => r.exercise === ex);
    const dailyMaxW = {};
    const dailyMax1RM = {};
    for (const r of g) {
      dailyMaxW[r.date] = Math.max(dailyMaxW[r.date]||0, r.weightKg);
      const e1rm = r.weightKg * (1 + r.reps/30);
      dailyMax1RM[r.date] = Math.max(dailyMax1RM[r.date]||0, e1rm);
    }
    perExercise[ex] = { dailyMaxW, dailyMax1RM };
  }

  return { daily, exercises, perExercise };
}

function toChartData(series){
  const labels = Object.keys(series).sort();
  const data = labels.map(k => series[k]);
  return { labels, data };
}

async function refreshExerciseOptions(){
  const { exercises } = await computeSeries();
  const cur = exerciseSelect.value;
  exerciseSelect.innerHTML = '';
  for (const ex of exercises) {
    const opt = document.createElement('option');
    opt.value = ex; opt.textContent = ex;
    exerciseSelect.appendChild(opt);
  }
  if (exercises.length){
    exerciseSelect.value = exercises.includes(cur) ? cur : exercises[0];
  }
}

async function drawAllCharts(){
  const { daily, perExercise } = await computeSeries();

  // 1) 日次総ボリューム
  const ctx1 = document.getElementById('dailyVolumeChart').getContext('2d');
  const dv = toChartData(daily);
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(ctx1, {
    type: 'line',
    data: { labels: dv.labels, datasets: [{ label:'Volume(kg)', data: dv.data, tension:.25, fill:true }] },
    options: { responsive:true, maintainAspectRatio:false }
  });

  // 2) 種目別
  const ex = exerciseSelect.value;
  if (!ex || !perExercise[ex]) return;
  const ctx2 = document.getElementById('exerciseMaxChart').getContext('2d');
  const ctx3 = document.getElementById('exercise1RMChart').getContext('2d');

  const maxW = toChartData(perExercise[ex].dailyMaxW);
  const e1 = toChartData(perExercise[ex].dailyMax1RM);

  if (maxChart) maxChart.destroy();
  if (rmChart) rmChart.destroy();

  maxChart = new Chart(ctx2, {
    type: 'line',
    data: { labels: maxW.labels, datasets: [{ label:`${ex} 最大重量(kg)`, data: maxW.data, tension:.25, fill:false }] },
    options: { responsive:true, maintainAspectRatio:false }
  });
  rmChart = new Chart(ctx3, {
    type: 'line',
    data: { labels: e1.labels, datasets: [{ label:`${ex} 推定1RM(kg)`, data: e1.data, tension:.25, fill:false }] },
    options: { responsive:true, maintainAspectRatio:false }
  });
}

exerciseSelect.addEventListener('change', drawAllCharts);

// ===== バックアップ =====
document.getElementById('exportBtn').addEventListener('click', async ()=>{
  const rows = await db.workouts.toArray();
  const blob = new Blob([JSON.stringify(rows, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.getElementById('downloadLink');
  a.href = url; a.download = `workouts_${new Date().toISOString().slice(0,10)}.json`;
  a.textContent = 'ダウンロードを開始（タップ）';
  a.style.display = 'inline-block';
});

document.getElementById('importBtn').addEventListener('click', async ()=>{
  const file = document.getElementById('importFile').files[0];
  if (!file) { alert('JSONファイルを選択してください'); return; }
  const text = await file.text();
  let arr;
  try { arr = JSON.parse(text); } catch(e){ alert('JSONの形式が不正です'); return; }
  await db.transaction('rw', db.workouts, async ()=>{
    for (const r of arr) {
      const obj = {
        id: r.id, date: r.date, exercise: r.exercise,
        weightKg: Number(r.weightKg), reps: Number(r.reps), sets: Number(r.sets),
        notes: r.notes || ''
      };
      if (obj.id) await db.workouts.put(obj); else await db.workouts.add(obj);
    }
  });
  await refreshList();
  await refreshExerciseOptions();
  alert('インポート完了');
});

// ===== ユーティリティ =====
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 初期ロード
(async function init(){
  await refreshList();
  await refreshExerciseOptions();
})();