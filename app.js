/* global XLSX */

const EXCEL_PATH = "data/szavak.xlsx";

// State
let workbook = null;
let dataBySheet = new Map(); // sheetName -> rows [{lesson,en,hu}]
let current = {
  sheet: null,
  lesson: null,
  mode: "HU_TO_EN_TYPE",
  count: 10,
  questions: [], // [{prompt, correct, options?, accept?}]
  index: 0,
  score: 0,
  locked: false,
};

const el = (id) => document.getElementById(id);

function showStatus(msg, type = "warn") {
  const box = el("status");
  box.classList.remove("hidden");
  box.textContent = msg;
  box.className = "p-3 rounded mb-4 " + (
    type === "error" ? "bg-rose-100 text-rose-900"
    : type === "ok" ? "bg-emerald-100 text-emerald-900"
    : "bg-amber-100 text-amber-900"
  );
}

function hideStatus() {
  const box = el("status");
  box.classList.add("hidden");
}

function normalize(s) {
  return (s ?? "").toString().trim();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function unique(arr) {
  return [...new Set(arr)];
}

function parseSheetToRows(sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Heurisztika: ha első sor fejléc, hagyjuk ki
  // (A,B,C) = (lecke, en, hu)
  let start = 0;
  if (rows.length > 0) {
    const r0 = rows[0].map(x => normalize(x).toLowerCase());
    if (r0.includes("lecke") || r0.includes("lesson") || r0.includes("english") || r0.includes("magyar")) {
      start = 1;
    }
  }

  const out = [];
  for (let i = start; i < rows.length; i++) {
    const [lesson, en, hu] = rows[i];
    const L = normalize(lesson);
    const E = normalize(en);
    const H = normalize(hu);
    if (!L || !E || !H) continue;
    out.push({ lesson: L, en: E, hu: H });
  }
  return out;
}

async function loadExcel() {
  hideStatus();
  try {
    const res = await fetch(EXCEL_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error(`Nem tudom betölteni: ${EXCEL_PATH} (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    workbook = XLSX.read(buf, { type: "array" });

    dataBySheet.clear();
    workbook.SheetNames.forEach((name) => {
      const rows = parseSheetToRows(name);
      dataBySheet.set(name, rows);
    });

    initSelectors();
    showStatus("Excel betöltve. Válassz évfolyamot és leckét.", "ok");
  } catch (e) {
    showStatus(`Hiba: ${e.message}`, "error");
    console.error(e);
  }
}

function initSelectors() {
  const gradeSelect = el("gradeSelect");
  gradeSelect.innerHTML = "";
  workbook.SheetNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    gradeSelect.appendChild(opt);
  });

  gradeSelect.addEventListener("change", () => {
    populateLessons(gradeSelect.value);
  });

  // default
  const defaultSheet = workbook.SheetNames[0] ?? null;
  if (defaultSheet) {
    gradeSelect.value = defaultSheet;
    populateLessons(defaultSheet);
  }
}

function populateLessons(sheetName) {
  const lessonSelect = el("lessonSelect");
  lessonSelect.innerHTML = "";

  const rows = dataBySheet.get(sheetName) ?? [];
  const lessons = unique(rows.map(r => r.lesson)).sort((a, b) => a.localeCompare(b, "hu"));

  lessons.forEach((L) => {
    const opt = document.createElement("option");
    opt.value = L;
    opt.textContent = L;
    lessonSelect.appendChild(opt);
  });

  if (lessons.length === 0) {
    showStatus(`Nincs használható adat ezen a munkalapon: "${sheetName}".`, "error");
  } else {
    hideStatus();
  }
}

function buildQuestions(sheetName, lesson, mode, count) {
  const rows = dataBySheet.get(sheetName) ?? [];
  const lessonRows = rows.filter(r => r.lesson === lesson);

  if (lessonRows.length === 0) return [];

  // Kérdések alap: random mintavétel a lecke szavaiból
  const pool = shuffle(lessonRows);
  const picked = [];
  while (picked.length < count) {
    picked.push(pool[picked.length % pool.length]); // ha kevés szó van, körbeér
    if (picked.length >= count) break;
  }

  // Distraktor pool: prefer ugyanabból a leckéből, ha kevés, akkor egész sheetből kiegészít
  const fallbackPool = rows;

  const qs = picked.map((item) => {
    if (mode === "HU_TO_EN_TYPE") {
      return {
        prompt: item.hu,
        correct: item.en,
        accept: (answer) => normalize(answer).toLowerCase() === item.en.toLowerCase(),
        meta: `Mutatott: magyar → írd angolul`,
      };
    }

    if (mode === "HU_TO_EN_MC") {
      const options = buildOptions(
        item.en,
        lessonRows.map(r => r.en),
        fallbackPool.map(r => r.en)
      );
      return {
        prompt: item.hu,
        correct: item.en,
        options,
        meta: `Mutatott: magyar → válaszd az angolt`,
      };
    }

    // EN_TO_HU_MC
    const options = buildOptions(
      item.hu,
      lessonRows.map(r => r.hu),
      fallbackPool.map(r => r.hu)
    );
    return {
      prompt: item.en,
      correct: item.hu,
      options,
      meta: `Mutatott: angol → válaszd a magyart`,
    };
  });

  return qs;
}

function buildOptions(correct, preferredPool, fallbackPool) {
  const pref = shuffle(unique(preferredPool).filter(x => x !== correct));
  const fb = shuffle(unique(fallbackPool).filter(x => x !== correct));

  const opts = [correct];
  // 3 distractor
  while (opts.length < 4 && pref.length) opts.push(pref.shift());
  while (opts.length < 4 && fb.length) opts.push(fb.shift());

  // ha még mindig nincs meg 4 (nagyon kevés adat), duplikáció nélkül ennyit tud
  return shuffle(unique(opts)).slice(0, 4);
}

function startQuiz() {
  const sheet = el("gradeSelect").value;
  const lesson = el("lessonSelect").value;
  const mode = el("modeSelect").value;
  const count = Math.max(1, parseInt(el("countInput").value || "10", 10));

  const qs = buildQuestions(sheet, lesson, mode, count);
  if (qs.length === 0) {
    showStatus("Nincs kérdés ehhez a választáshoz. Ellenőrizd az Excelt.", "error");
    return;
  }

  current = {
    sheet, lesson, mode, count,
    questions: qs,
    index: 0,
    score: 0,
    locked: false,
  };

  el("idleArea").classList.add("hidden");
  el("quizArea").classList.remove("hidden");
  el("restartBtn").classList.add("hidden");

  updateScoreUI();
  renderQuestion();
}

function updateScoreUI() {
  el("score").textContent = String(current.score);
  el("progress").textContent = `${Math.min(current.index + 1, current.questions.length)}/${current.questions.length}`;
}

function setFeedback(msg, ok) {
  const fb = el("feedback");
  fb.classList.remove("hidden");
  fb.textContent = msg;
  fb.className = "mt-4 p-3 rounded-lg " + (ok ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900");
}

function clearFeedback() {
  el("feedback").classList.add("hidden");
  el("feedback").textContent = "";
}

function renderQuestion() {
  current.locked = false;
  clearFeedback();
  el("nextBtn").classList.add("hidden");

  const q = current.questions[current.index];
  el("metaLine").textContent = `${current.sheet} • ${current.lesson} • ${q.meta}`;
  el("prompt").textContent = q.prompt;

  const typeArea = el("typeAnswerArea");
  const mcArea = el("mcArea");

  if (current.mode === "HU_TO_EN_TYPE") {
    typeArea.classList.remove("hidden");
    mcArea.classList.add("hidden");
    el("textAnswer").value = "";
    el("textAnswer").focus();
  } else {
    typeArea.classList.add("hidden");
    mcArea.classList.remove("hidden");
    mcArea.innerHTML = "";

    q.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "w-full text-left border rounded-xl p-3 hover:bg-slate-50";
      btn.textContent = opt;
      btn.addEventListener("click", () => handleMC(opt));
      mcArea.appendChild(btn);
    });
  }

  updateScoreUI();
}

function lockAndShowNext() {
  current.locked = true;
  el("nextBtn").classList.remove("hidden");
}

function handleMC(chosen) {
  if (current.locked) return;
  const q = current.questions[current.index];

  const ok = chosen === q.correct;
  if (ok) current.score += 1;

  setFeedback(ok ? "✅ Helyes! +1 pont" : `❌ Nem jó. A helyes: ${q.correct}`, ok);
  updateScoreUI();
  lockAndShowNext();
}

function handleTextSubmit() {
  if (current.locked) return;
  const q = current.questions[current.index];
  const ans = el("textAnswer").value;

  const ok = q.accept(ans);
  if (ok) current.score += 1;

  setFeedback(ok ? "✅ Helyes! +1 pont" : `❌ Nem jó. A helyes: ${q.correct}`, ok);
  updateScoreUI();
  lockAndShowNext();
}

function nextQuestion() {
  if (!current.locked) return;

  current.index += 1;
  if (current.index >= current.questions.length) {
    // vége
    el("prompt").textContent = `Vége! Eredmény: ${current.score} / ${current.questions.length}`;
    el("metaLine").textContent = `${current.sheet} • ${current.lesson}`;
    el("typeAnswerArea").classList.add("hidden");
    el("mcArea").classList.add("hidden");
    el("nextBtn").classList.add("hidden");
    el("restartBtn").classList.remove("hidden");
    setFeedback("Újrakezdéshez kattints az Újrakezdés gombra.", true);
    return;
  }

  renderQuestion();
}

function wireUI() {
  el("startBtn").addEventListener("click", startQuiz);
  el("submitTextBtn").addEventListener("click", handleTextSubmit);
  el("textAnswer").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleTextSubmit();
  });
  el("nextBtn").addEventListener("click", nextQuestion);
  el("restartBtn").addEventListener("click", startQuiz);
}

wireUI();
loadExcel();