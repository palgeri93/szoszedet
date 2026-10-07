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
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const headers = (rows[0] ?? []).map(x => normalize(x).toLowerCase());
  const enHeader = headers.findIndex(x => x === "angol szó" || x === "english" || x === "en");
  const huHeader = headers.findIndex(x => x === "magyar szó" || x === "magyar" || x === "hu");
  const lessonHeader = headers.findIndex(x => x === "lecke" || x === "lesson");
  const numberHeader = headers.findIndex(x => ["szám", "sorszám", "szószedet száma", "number"].includes(x));
  const hasHeader = lessonHeader >= 0 || enHeader >= 0 || huHeader >= 0 || numberHeader >= 0;
  // Az új minta: A=lecke, B=szám (üres fejléc is lehet), C=angol, D=magyar.
  const numbered = numberHeader >= 0 || enHeader === 2 || (!hasHeader && rows.some(r => r.length >= 4));
  const lessonCol = lessonHeader >= 0 ? lessonHeader : 0;
  const numberCol = numberHeader >= 0 ? numberHeader : 1;
  const enCol = enHeader >= 0 ? enHeader : numbered ? 2 : 1;
  const huCol = huHeader >= 0 ? huHeader : numbered ? 3 : 2;
  const counters = new Map();
  const out = [];
  for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
    const row = rows[i];
    const lesson = normalize(row[lessonCol]);
    const en = normalize(row[enCol]);
    const hu = normalize(row[huCol]);
    if (!lesson || !en || !hu) continue;
    let number;
    if (numbered) {
      const value = normalize(row[numberCol]);
      if (!value) continue;
      number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) {
        throw new Error('Érvénytelen szószedetszám: ' + sheetName + ', ' + (i + 1) + '. sor. Pozitív egész szám szükséges.');
      }
    } else {
      number = (counters.get(lesson) ?? 0) + 1;
      counters.set(lesson, number);
    }
    out.push({ lesson, number, en, hu });
  }
  return out;
}

async function loadExcel(file = null) {
  hideStatus();
  try {
    if (!file && location.protocol === "file:") {
      showStatus("Az automatikus Excel-betöltéshez az Inditas.cmd fájllal indítsd az alkalmazást. Vagy válaszd ki az Excelt az alábbi gombbal.");
      return;
    }
    let buf;
    if (file) {
      buf = await file.arrayBuffer();
    } else {
      const res = await fetch(EXCEL_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(`Nem tudom betölteni: ${EXCEL_PATH} (HTTP ${res.status})`);
      buf = await res.arrayBuffer();
    }
    stopTimer();
    el("quizArea").classList.add("hidden");
    el("idleArea").classList.remove("hidden");
    workbook = XLSX.read(buf, { type: "array" });

    dataBySheet.clear();
    workbook.SheetNames.forEach((name) => {
      const rows = parseSheetToRows(name);
      dataBySheet.set(name, rows);
    });

    initSelectors();
    showStatus("Excel betöltve. Add meg a neved, majd válassz évfolyamot és leckét.", "ok");
  } catch (e) {
    showStatus(`Hiba: ${e.message}. Válaszd ki az Excel-fájlt az alábbi gombbal.`, "error");
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

  gradeSelect.onchange = () => {
    populateLessons(gradeSelect.value);
  };

  el("lessonSelect").onchange = () => {
    refreshLessonStatsAndDefaults();
  };

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
  const rows = getLessonRows(el("gradeSelect").value, el("lessonSelect").value);
  el("lessonCount").textContent = String(rows.length);
  const numbers = rows.map(r => r.number);
  const min = numbers.length ? Math.min(...numbers) : 1;
  const max = numbers.length ? Math.max(...numbers) : 1;
  el("rangeFrom").value = String(min);
  el("rangeTo").value = String(max);
  for (const id of ["rangeFrom", "rangeTo"]) {
    el(id).min = String(min);
    el(id).max = String(max);
    el(id).step = "1";
    el(id).disabled = rows.length === 0;
    el(id).setCustomValidity("");
  }
  el("rangeHint").textContent = rows.length
    ? `Ebben a leckében ${min}–${max} közötti szószedetszámok szerepelnek.`
    : "Ebben a leckében nincs kérdezhető szó.";
}

function getRangeError(sheet, lesson, value) {
  const rows = getLessonRows(sheet, lesson);
  if (!rows.length) return "Ebben a leckében nincs kérdezhető szó.";
  const numbers = rows.map(row => row.number);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const number = Number(normalize(value));
  if (!normalize(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    return `Ehhez a leckéhez ${min}–${max} közötti egész számot adj meg. A legnagyobb szószedetszám: ${max}.`;
  }
  if (!numbers.includes(number)) return `A ${number} szám nem szerepel ennek a leckének a szószedetében.`;
  return "";
}

function validateRangeInputs() {
  let valid = true;
  for (const id of ["rangeFrom", "rangeTo"]) {
    const message = getRangeError(el("gradeSelect").value, el("lessonSelect").value, el(id).value);
    el(id).setCustomValidity(message);
    if (message) valid = false;
  }
  return valid;
}

function resolveLessonRangeRows(sheet, lesson, from1, to1) {
  const lessonRows = getLessonRows(sheet, lesson);
  const from = Number(normalize(from1));
  const to = Number(normalize(to1));
  if (getRangeError(sheet, lesson, from1) || getRangeError(sheet, lesson, to1)) {
    return { sliced: [], total: lessonRows.length, a: from, b: to };
  }
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const sliced = lessonRows.filter(row => row.number >= a && row.number <= b);
  return { sliced, total: lessonRows.length, a, b };
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
  if (!validateRangeInputs()) {
    const invalid = [el("rangeFrom"), el("rangeTo")].find(input => !input.validity.valid);
    showStatus(invalid.validationMessage, "error");
    invalid.reportValidity();
    return;
  }

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
    `${current.sheet} • ${current.lesson} • ${modeLabel} • Szószedetszám: ${current.rangeFrom}–${current.rangeTo} • ${current.lessonTotal} szó a leckében`;

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
  el("excelFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) await loadExcel(file);
    event.target.value = "";
  });
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
  el("rangeFrom").addEventListener("input", validateRangeInputs);
  el("rangeTo").addEventListener("input", validateRangeInputs);
}

wireUI();
loadExcel();
updateLastScoreLine();
