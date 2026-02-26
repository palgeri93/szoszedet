/* global XLSX */

const EXCEL_PATH = "data/szavak.xlsx";
const SCORE_KEY = "vocabTrainerScores_v1"; // localStorage kulcs

// State
let workbook = null;
let dataBySheet = new Map(); // sheetName -> rows [{lesson,en,hu}]
let timerHandle = null;

let current = {
  name: "",
  sheet: null,
  lesson: null,
  mode: "HU_TO_EN_TYPE",
  noRepeat: false,
  count: 10,
  rangeFrom: 1,
  rangeTo: 1,
  lessonTotal: 0,
  questions: [], // [{mode,prompt,correct,options?,accept?,meta}]
  index: 0,
  score: 0,
  locked: false,
  startTs: 0,
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

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stopTimer() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function startTimer() {
  stopTimer();
  current.startTs = Date.now();
  el("timer").textContent = "00:00";
  timerHandle = setInterval(() => {
    el("timer").textContent = formatTime(Date.now() - current.startTs);
  }, 250);
}

function getScores() {
  try {
    return JSON.parse(localStorage.getItem(SCORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setScores(scoresObj) {
  localStorage.setItem(SCORE_KEY, JSON.stringify(scoresObj));
}

function updateLastScoreLine() {
  const name = normalize(el("nameInput").value);
  if (!name) {
    el("lastScoreLine").textContent = "—";
    return;
  }
  const scores = getScores();
  const rec = scores[name];
  if (!rec) {
    el("lastScoreLine").textContent = "nincs mentett eredmény";
    return;
  }
  el("lastScoreLine").textContent =
    `${rec.score}/${rec.total} • ${rec.seconds}s • ${rec.when}`;
}

function parseSheetToRows(sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

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
    showStatus("Excel betöltve. Add meg a neved, majd válassz évfolyamot és leckét.", "ok");
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

  el("lessonSelect").addEventListener("change", () => {
    refreshLessonStatsAndDefaults();
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
    el("lessonCount").textContent = "0";
    showStatus(`Nincs használható adat ezen a munkalapon: "${sheetName}".`, "error");
  } else {
    hideStatus();
    lessonSelect.value = lessons[0];
    refreshLessonStatsAndDefaults();
  }
}

function getLessonRows(sheetName, lesson) {
  const rows = dataBySheet.get(sheetName) ?? [];
  // Megőrizzük az eredeti sorrendet (Excel sorrend)
  return rows.filter(r => r.lesson === lesson);
}

function clampInt(x, min, max) {
  const n = parseInt(String(x || ""), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function refreshLessonStatsAndDefaults() {
  const sheet = el("gradeSelect").value;
  const lesson = el("lessonSelect").value;
  const lessonRows = getLessonRows(sheet, lesson);
  const total = lessonRows.length;

  el("lessonCount").textContent = String(total);

  // alapértelmezett: 1 és utolsó
  el("rangeFrom").value = "1";
  el("rangeTo").value = String(Math.max(1, total));
}

function resolveLessonRangeRows(sheet, lesson, from1, to1) {
  const lessonRows = getLessonRows(sheet, lesson);
  const total = lessonRows.length;
  // 1-indexelt tartomány -> 0-index slice
  const from = clampInt(from1, 1, Math.max(1, total));
  const to = clampInt(to1, 1, Math.max(1, total));
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const sliced = lessonRows.slice(a - 1, b); // b inclusive, slice end exclusive -> b
  return { sliced, total, a, b };
}

function chooseMode(baseMode) {
  if (baseMode !== "RANDOM_MIX") return baseMode;
  const modes = ["HU_TO_EN_TYPE", "HU_TO_EN_MC", "EN_TO_HU_MC"];
  return modes[Math.floor(Math.random() * modes.length)];
}

function buildOptions(correct, preferredPool, fallbackPool) {
  const pref = shuffle(unique(preferredPool).filter(x => x !== correct));
  const fb = shuffle(unique(fallbackPool).filter(x => x !== correct));

  const opts = [correct];
  while (opts.length < 4 && pref.length) opts.push(pref.shift());
  while (opts.length < 4 && fb.length) opts.push(fb.shift());

  return shuffle(unique(opts)).slice(0, 4);
}

function buildQuestionFromItem(item, qMode, lessonRows, fallbackRows) {
  if (qMode === "HU_TO_EN_TYPE") {
    return {
      mode: qMode,
      prompt: item.hu,
      correct: item.en,
      accept: (answer) => normalize(answer).toLowerCase() === item.en.toLowerCase(),
      meta: `Mutatott: magyar → írd angolul`,
    };
  }

  if (qMode === "HU_TO_EN_MC") {
    const options = buildOptions(
      item.en,
      lessonRows.map(r => r.en),
      fallbackRows.map(r => r.en)
    );
    return {
      mode: qMode,
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
    fallbackRows.map(r => r.hu)
  );
  return {
    mode: qMode,
    prompt: item.en,
    correct: item.hu,
    options,
    meta: `Mutatott: angol → válaszd a magyart`,
  };
}

function buildQuestions(sheetName, lesson, baseMode, count, noRepeat, rangeFrom, rangeTo) {
  const fallbackRows = dataBySheet.get(sheetName) ?? [];
  const { sliced, total, a, b } = resolveLessonRangeRows(sheetName, lesson, rangeFrom, rangeTo);

  if (total === 0 || sliced.length === 0) return { questions: [], info: { total, a, b, available: 0 } };

  const available = sliced.length;
  let pickedItems;

  if (noRepeat) {
    // egyszer kérdezze: ha count > available, nem tudjuk megoldani ismétlés nélkül
    const pool = shuffle(sliced);
    pickedItems = pool.slice(0, Math.min(count, pool.length));
  } else {
    // lehet ismétlés: körbeér
    const pool = shuffle(sliced);
    pickedItems = [];
    while (pickedItems.length < count) {
      pickedItems.push(pool[pickedItems.length % pool.length]);
      if (pickedItems.length >= count) break;
    }
  }

  const questions = pickedItems.map((item) => {
    const qMode = chooseMode(baseMode);
    return buildQuestionFromItem(item, qMode, sliced, fallbackRows);
  });

  return { questions, info: { total, a, b, available } };
}

function startQuiz() {
  const name = normalize(el("nameInput").value);
  if (!name) {
    showStatus("Kérlek, add meg a neved a kezdéshez.", "error");
    return;
  }

  const sheet = el("gradeSelect").value;
  const lesson = el("lessonSelect").value;
  const mode = el("modeSelect").value;
  const noRepeat = el("noRepeatToggle").checked;
  const count = Math.max(1, parseInt(el("countInput").value || "10", 10));

  // intervallum
  const from = el("rangeFrom").value;
  const to = el("rangeTo").value;

  const { questions, info } = buildQuestions(sheet, lesson, mode, count, noRepeat, from, to);

  if (questions.length === 0) {
    showStatus("Nincs kérdés ehhez a választáshoz. Ellenőrizd az Excelt és/vagy az intervallumot.", "error");
    return;
  }

  // ha noRepeat és kevés szó van
  if (noRepeat && count > info.available) {
    showStatus(
      `Figyelem: az intervallumban csak ${info.available} szó van, ezért ismétlés nélkül maximum ennyi kérdés tehető fel.`,
      "warn"
    );
  } else {
    hideStatus();
  }

  current = {
    name,
    sheet,
    lesson,
    mode,
    noRepeat,
    count,
    rangeFrom: info.a,
    rangeTo: info.b,
    lessonTotal: info.total,
    questions,
    index: 0,
    score: 0,
    locked: false,
    startTs: 0,
  };

  el("idleArea").classList.add("hidden");
  el("quizArea").classList.remove("hidden");
  el("restartBtn").classList.add("hidden");

  updateScoreUI();
  startTimer();
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
  const modeLabel =
    q.mode === "HU_TO_EN_TYPE" ? "HU→EN (írás)"
    : q.mode === "HU_TO_EN_MC" ? "HU→EN (választós)"
    : "EN→HU (választós)";

  el("metaLine").textContent =
    `${current.sheet} • ${current.lesson} • ${modeLabel} • Intervallum: ${current.rangeFrom}-${current.rangeTo} / ${current.lessonTotal}`;

  el("prompt").textContent = q.prompt;

  const typeArea = el("typeAnswerArea");
  const mcArea = el("mcArea");

  if (q.mode === "HU_TO_EN_TYPE") {
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

function saveScoreAtEnd() {
  const ms = Date.now() - current.startTs;
  const seconds = Math.max(1, Math.floor(ms / 1000));
  const when = new Date().toLocaleString("hu-HU");

  const rec = {
    score: current.score,
    total: current.questions.length,
    seconds,
    when,
    sheet: current.sheet,
    lesson: current.lesson,
    mode: current.mode,
    range: `${current.rangeFrom}-${current.rangeTo}`,
  };

  const scores = getScores();
  // név alapján felülírjuk a legutóbbit (egyszerű és egyértelmű)
  scores[current.name] = rec;
  setScores(scores);
  updateLastScoreLine();
  return rec;
}

function nextQuestion() {
  if (!current.locked) return;

  current.index += 1;

  if (current.index >= current.questions.length) {
    stopTimer();
    const rec = saveScoreAtEnd();

    el("prompt").textContent = `Vége! Eredmény: ${current.score} / ${current.questions.length}`;
    el("metaLine").textContent = `${current.sheet} • ${current.lesson} • Mentve: ${current.name}`;
    el("typeAnswerArea").classList.add("hidden");
    el("mcArea").classList.add("hidden");
    el("nextBtn").classList.add("hidden");
    el("restartBtn").classList.remove("hidden");

    setFeedback(
      `Mentve (${current.name}): ${rec.score}/${rec.total} • idő: ${formatTime(rec.seconds * 1000)} • ${rec.when}`,
      true
    );
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
  el("restartBtn").addEventListener("click", () => {
    // Újrakezdéskor új kérdéssor is legyen (randomizálás miatt)
    startQuiz();
  });

  el("nameInput").addEventListener("input", updateLastScoreLine);

  // ha manuálisan átírják az intervallumot, ne akadjon meg a UI
  el("rangeFrom").addEventListener("input", () => {});
  el("rangeTo").addEventListener("input", () => {});
}

wireUI();
loadExcel();
updateLastScoreLine();