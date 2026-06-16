import "./styles.css";
import {
  addAttempt,
  addBank,
  getAttempts,
  getAttemptsByQuestion,
  getBanks,
  getQuestion,
  getQuestions,
  getQuestionsByBank,
  getState,
  replaceAllData,
  saveState,
  updateState
} from "./db";
import { backupToFile, parseQuestionBank } from "./importers";
import { correctRate, dateKey, lastSevenDays, secondsLabel, streakDays, typeSummaries } from "./stats";
import type { AppState, Attempt, PracticeSession, Question, QuestionType } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

type Route = "home" | "import" | "practice" | "wrong" | "favorite" | "stats" | "essay";

interface DraftAnswer {
  questionId: string;
  selected: string[];
  textAnswer: string;
  submitted: boolean;
  correct: boolean | null;
}

let route: Route = "home";
let toastTimer = 0;
let draft: DraftAnswer | null = null;
let questionStartedAt = Date.now();
let wrongTypeFilter: QuestionType | "all" = "all";
let bundledBankChecked = false;

const typeLabel: Record<QuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
  essay: "解答题"
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function setRoute(nextRoute: Route): void {
  route = nextRoute;
  draft = null;
  render();
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  toastTimer = window.setTimeout(() => node.remove(), 2400);
}

function applyTheme(state: AppState): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", state.theme === "dark" || (state.theme === "system" && prefersDark));
}

async function ensureBundledBank(): Promise<void> {
  if (bundledBankChecked) return;
  bundledBankChecked = true;

  const banks = await getBanks();
  if (banks.length > 0) return;

  await importBundledBank();
}

async function importBundledBank(): Promise<boolean> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/question-bank.json`);
    if (!response.ok) return false;
    const blob = await response.blob();
    const file = new File([blob], "question-bank.json", { type: "application/json" });
    const result = await parseQuestionBank(file);
    await addBank(result.bank, result.questions);
    showToast(`已自动导入内置题库：${result.questions.length} 道题。`);
    return true;
  } catch {
    // 内置题库导入失败时保持空状态，用户仍可手动导入自己的题库。
    return false;
  }
}

function shell(content: string): string {
  return `<main class="app-shell">${content}</main>`;
}

function backHeader(title: string, subtitle = ""): string {
  return `
    <div class="topbar">
      <button class="icon-button" data-action="home" aria-label="返回首页">‹</button>
      <div class="screen-title">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <span></span>
    </div>
  `;
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function normalizeAnswerItem(item: string, options: string[]): string {
  const text = item.trim();
  const upper = text.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    const index = upper.charCodeAt(0) - 65;
    if (options[index]) return options[index].trim();
  }
  if (["对", "是", "true", "正确"].includes(text.toLowerCase())) return "正确";
  if (["错", "否", "false", "错误"].includes(text.toLowerCase())) return "错误";
  return text;
}

function normalizedSet(items: string[], options: string[]): Set<string> {
  return new Set(items.map((item) => normalizeAnswerItem(item, options).trim().toLowerCase()).filter(Boolean));
}

function isCorrect(question: Question, selected: string[]): boolean {
  const answerSet = normalizedSet(question.answer, question.options);
  const selectedSet = normalizedSet(selected, question.options);
  if (answerSet.size !== selectedSet.size) return false;
  return [...answerSet].every((item) => selectedSet.has(item));
}

function answerText(question: Question): string {
  return question.answer.map((item) => normalizeAnswerItem(item, question.options)).join("、") || "未提供";
}

function getDurationSeconds(): number {
  return Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000));
}

async function recordAttempt(question: Question, selected: string[], textAnswer: string, correct: boolean, selfMarked: boolean): Promise<void> {
  const durationSeconds = getDurationSeconds();
  const attempt: Attempt = {
    id: uid("attempt"),
    questionId: question.id,
    bankId: question.bankId,
    type: question.type,
    selected,
    textAnswer,
    correct,
    selfMarked,
    durationSeconds,
    createdAt: new Date().toISOString()
  };

  await addAttempt(attempt);
  await updateState((state) => {
    const wrongIds = new Set(state.wrongIds);
    const masteredIds = new Set(state.masteredIds);

    if (correct) {
      masteredIds.add(question.id);
      wrongIds.delete(question.id);
    } else {
      wrongIds.add(question.id);
      masteredIds.delete(question.id);
    }

    const today = dateKey();
    return {
      ...state,
      wrongIds: [...wrongIds],
      masteredIds: [...masteredIds],
      dailySeconds: {
        ...state.dailySeconds,
        [today]: (state.dailySeconds[today] ?? 0) + durationSeconds
      },
      lastStudyDate: today
    };
  });
}

async function startSession(mode: PracticeSession["mode"]): Promise<void> {
  const state = await getState();
  const questions = await getQuestions();
  let pool = questions;

  if (mode === "wrong") pool = questions.filter((question) => state.wrongIds.includes(question.id));
  if (mode === "favorite") pool = questions.filter((question) => state.favoriteIds.includes(question.id));
  if (mode === "essay") pool = questions.filter((question) => question.type === "essay");
  if (mode === "random") pool = shuffle(pool);

  if (pool.length === 0) {
    showToast(mode === "wrong" ? "错题本还没有题目。" : mode === "favorite" ? "收藏夹还没有题目。" : "请先导入题库。");
    return;
  }

  const session: PracticeSession = {
    mode,
    questionIds: pool.map((question) => question.id),
    index: 0,
    startedAt: new Date().toISOString()
  };

  await saveState({ ...state, currentSession: session });
  questionStartedAt = Date.now();
  route = "practice";
  draft = null;
  render();
}

async function moveQuestion(offset: number): Promise<void> {
  const state = await getState();
  const session = state.currentSession;
  if (!session) return;
  const nextIndex = Math.max(0, Math.min(session.questionIds.length - 1, session.index + offset));
  await saveState({ ...state, currentSession: { ...session, index: nextIndex } });
  draft = null;
  questionStartedAt = Date.now();
  render();
}

async function jumpQuestion(): Promise<void> {
  const state = await getState();
  const session = state.currentSession;
  const input = document.querySelector<HTMLInputElement>("#jumpIndex");
  if (!session || !input) return;
  const index = Number(input.value) - 1;
  if (!Number.isFinite(index) || index < 0 || index >= session.questionIds.length) {
    showToast("请输入有效题号。");
    return;
  }
  await saveState({ ...state, currentSession: { ...session, index } });
  draft = null;
  questionStartedAt = Date.now();
  render();
}

async function toggleFavorite(questionId: string): Promise<void> {
  await updateState((state) => {
    const ids = new Set(state.favoriteIds);
    ids.has(questionId) ? ids.delete(questionId) : ids.add(questionId);
    return { ...state, favoriteIds: [...ids] };
  });
  render();
}

async function markMastered(questionId: string): Promise<void> {
  await updateState((state) => ({
    ...state,
    wrongIds: state.wrongIds.filter((id) => id !== questionId),
    masteredIds: Array.from(new Set([...state.masteredIds, questionId]))
  }));
  showToast("已从错题本移除。");
  render();
}

async function renderHome(): Promise<void> {
  await ensureBundledBank();
  const [state, banks, questions, attempts] = await Promise.all([getState(), getBanks(), getQuestions(), getAttempts()]);
  applyTheme(state);
  const todayCount = attempts.filter((attempt) => attempt.createdAt.slice(0, 10) === dateKey()).length;
  const progress = questions.length ? Math.min(100, Math.round((attempts.length / questions.length) * 100)) : 0;
  const lastSession = state.currentSession;

  app.innerHTML = shell(`
    <div class="topbar">
      <div class="brand">
        <h1>刷题本</h1>
        <p>${banks.length ? `${banks.length} 个题库，${questions.length} 道题` : "导入题库后即可离线刷题"}</p>
      </div>
      <button class="icon-button" data-action="theme" aria-label="切换深浅色">${document.documentElement.classList.contains("dark") ? "☀" : "☾"}</button>
    </div>

    <section class="hero-panel">
      <div class="progress-line">
        <span>今日完成 ${todayCount} 题</span>
        <span>正确率 ${correctRate(attempts)}%</span>
      </div>
      <div class="bar" aria-label="学习进度"><span style="width:${progress}%"></span></div>
      <p class="meta">连续学习 ${streakDays(attempts)} 天 · 错题 ${state.wrongIds.length} 道 · 收藏 ${state.favoriteIds.length} 道</p>
      ${
        lastSession
          ? `<button class="primary-button" data-action="resume">继续上次学习 ${lastSession.index + 1}/${lastSession.questionIds.length}</button>`
          : `<button class="primary-button" data-action="start-sequential">开始刷题</button>`
      }
      ${questions.length === 0 ? `<button class="secondary-button" data-action="import-bundled" style="margin-top:10px">重新导入内置题库</button>` : ""}
    </section>

    <div class="action-grid">
      <button class="action-card" data-action="start-sequential"><strong>顺序练习</strong><span>按题库顺序推进</span></button>
      <button class="action-card" data-action="start-random"><strong>随机练习</strong><span>打乱题目顺序</span></button>
      <button class="action-card" data-action="wrong"><strong>错题本</strong><span>${state.wrongIds.length} 道待巩固</span></button>
      <button class="action-card" data-action="favorite"><strong>收藏夹</strong><span>${state.favoriteIds.length} 道重点题</span></button>
      <button class="action-card" data-action="import"><strong>导入题库</strong><span>JSON / Excel / CSV</span></button>
      <button class="action-card" data-action="stats"><strong>学习统计</strong><span>趋势与正确率</span></button>
      <button class="action-card" data-action="start-essay"><strong>解答题专项</strong><span>主观题输入与记录</span></button>
      <button class="action-card" data-action="export-all"><strong>导出备份</strong><span>题库和学习数据</span></button>
    </div>

    <section class="panel">
      <strong>最近题库</strong>
      <div class="list" style="margin-top:10px">
        ${
          banks.length
            ? banks
                .slice(-3)
                .reverse()
                .map((bank) => `<div class="row"><div class="row-main"><strong>${escapeHtml(bank.title)}</strong><span class="meta">${bank.count} 道题</span></div></div>`)
                .join("")
            : `<div class="empty">还没有题库。先导入一个 JSON、CSV 或 Excel 文件。</div>`
        }
      </div>
    </section>
  `);
}

async function renderImport(): Promise<void> {
  const banks = await getBanks();
  app.innerHTML = shell(`
    ${backHeader("导入题库", "支持 JSON、CSV、.xlsx，也可恢复完整备份")}
    <section class="panel">
      <div class="file-drop">
        <strong>选择题库文件</strong>
        <span class="meta">表头建议：题型、题目、选项、答案、解析、章节。选项也可用 A/B/C/D 多列。</span>
        <input id="bankFile" type="file" accept=".json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        <button class="primary-button" data-action="import-bank">导入题库</button>
      </div>
    </section>
    <section class="panel">
      <strong>数据备份</strong>
      <p class="meta">备份包含题库、错题、收藏、历史作答和统计数据。</p>
      <div class="button-row">
        <button class="secondary-button" data-action="export-all">导出完整备份</button>
        <button class="secondary-button" data-action="export-banks">只导出题库</button>
      </div>
      <div class="field">
        <label for="backupFile">导入备份恢复</label>
        <input id="backupFile" type="file" accept=".json,application/json" />
      </div>
      <button class="danger-button" data-action="restore-backup">恢复备份</button>
    </section>
    <section class="panel">
      <strong>已导入题库</strong>
      <div class="list" style="margin-top:10px">
        ${
          banks.length
            ? banks.map((bank) => `<div class="row"><div class="row-main"><strong>${escapeHtml(bank.title)}</strong><span class="meta">${bank.count} 道题</span></div></div>`).join("")
            : `<div class="empty">暂无题库。</div>`
        }
      </div>
    </section>
  `);
}

async function importBank(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#bankFile");
  const file = input?.files?.[0];
  if (!file) {
    showToast("请先选择文件。");
    return;
  }

  try {
    const result = await parseQuestionBank(file);
    await addBank(result.bank, result.questions);
    showToast(`已导入：${result.bank.title}，共 ${result.questions.length} 道题。`);
    renderImport();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "导入失败，请检查文件格式。");
  }
}

async function exportAll(onlyBanks = false): Promise<void> {
  const [banks, questions, attempts, state] = await Promise.all([getBanks(), getQuestions(), getAttempts(), getState()]);
  backupToFile(
    onlyBanks ? { version: 1, exportedAt: new Date().toISOString(), banks, questions } : { version: 1, exportedAt: new Date().toISOString(), banks, questions, attempts, state },
    onlyBanks ? `题库备份-${dateKey()}.json` : `刷题本完整备份-${dateKey()}.json`
  );
}

async function restoreBackup(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#backupFile");
  const file = input?.files?.[0];
  if (!file) {
    showToast("请选择备份文件。");
    return;
  }

  try {
    const data = JSON.parse(await file.text());
    await replaceAllData({
      banks: data.banks ?? [],
      questions: data.questions ?? [],
      attempts: data.attempts ?? [],
      state: data.state ?? {
        favoriteIds: [],
        wrongIds: [],
        masteredIds: [],
        currentSession: null,
        theme: "system",
        dailySeconds: {},
        lastStudyDate: ""
      }
    });
    showToast("备份已恢复。");
    setRoute("home");
  } catch {
    showToast("备份文件无法识别。");
  }
}

function renderOption(question: Question, option: string, index: number, currentDraft: DraftAnswer): string {
  const selected = currentDraft.selected.includes(option);
  const answerSet = normalizedSet(question.answer, question.options);
  const isAnswer = answerSet.has(normalizeAnswerItem(option, question.options).toLowerCase());
  const classNames = ["option", selected ? "selected" : "", currentDraft.submitted && isAnswer ? "correct" : "", currentDraft.submitted && selected && !isAnswer ? "wrong" : ""]
    .filter(Boolean)
    .join(" ");
  const label = question.type === "judge" ? option : `${String.fromCharCode(65 + index)}. ${option}`;
  return `<button class="${classNames}" data-action="select-option" data-value="${escapeHtml(option)}">${escapeHtml(label)}</button>`;
}

async function renderPractice(): Promise<void> {
  const [state] = await Promise.all([getState()]);
  const session = state.currentSession;
  if (!session) {
    await renderHome();
    return;
  }

  const question = await getQuestion(session.questionIds[session.index]);
  if (!question) {
    await saveState({ ...state, currentSession: null });
    await renderHome();
    return;
  }

  if (!draft || draft.questionId !== question.id) {
    draft = { questionId: question.id, selected: [], textAnswer: "", submitted: false, correct: null };
    questionStartedAt = Date.now();
  }

  const favorited = state.favoriteIds.includes(question.id);
  const submitted = draft.submitted;
  const objective = question.type !== "essay";

  app.innerHTML = shell(`
    ${backHeader("练习", `${session.index + 1}/${session.questionIds.length} · ${typeLabel[question.type]} · ${question.chapter}`)}
    <section class="panel question-card">
      <div class="question-meta">
        <span>${typeLabel[question.type]}</span>
        <button class="icon-button" data-action="favorite-toggle" data-id="${question.id}" aria-label="收藏">${favorited ? "★" : "☆"}</button>
      </div>
      <h2 class="question-title">${escapeHtml(question.question)}</h2>
      ${
        objective
          ? `<div class="options">${question.options.map((option, index) => renderOption(question, option, index, draft!)).join("")}</div>`
          : `<textarea class="textarea" id="essayText" placeholder="在这里写下你的答案">${escapeHtml(draft.textAnswer)}</textarea>`
      }
      ${
        question.type === "multiple" && !submitted
          ? `<button class="primary-button" data-action="submit-objective">提交答案</button>`
          : question.type === "essay" && !submitted
            ? `<button class="primary-button" data-action="submit-essay">提交并查看标准答案</button>`
            : ""
      }
      ${
        submitted
          ? `
          <div class="answer-box">
            <strong>${draft.correct === null ? "参考答案" : draft.correct ? "回答正确" : "需要巩固"}</strong>
            <p>正确答案：${escapeHtml(answerText(question))}</p>
            ${question.analysis ? `<p>解析：${escapeHtml(question.analysis)}</p>` : ""}
            ${question.type === "multiple" ? `<p>${escapeHtml(multipleFeedback(question, draft.selected))}</p>` : ""}
          </div>
          ${
            question.type === "essay" && draft.correct === null
              ? `<div class="button-row"><button class="primary-button" data-action="essay-correct">已掌握</button><button class="danger-button" data-action="essay-wrong">未掌握</button></div>`
              : ""
          }
        `
          : ""
      }
      ${question.type === "essay" ? await essayHistoryHtml(question.id) : ""}
    </section>
    <section class="panel">
      <div class="field">
        <label for="jumpIndex">跳转题号</label>
        <input id="jumpIndex" type="number" min="1" max="${session.questionIds.length}" value="${session.index + 1}" inputmode="numeric" />
      </div>
      <button class="secondary-button" data-action="jump">跳转</button>
    </section>
    <nav class="bottom-nav" aria-label="做题导航">
      <button class="secondary-button" data-action="prev">上一题</button>
      <button class="secondary-button" data-action="home">首页</button>
      <button class="primary-button" data-action="next">下一题</button>
    </nav>
  `);
}

function multipleFeedback(question: Question, selected: string[]): string {
  const answerSet = normalizedSet(question.answer, question.options);
  const selectedSet = normalizedSet(selected, question.options);
  const missed = [...answerSet].filter((item) => !selectedSet.has(item));
  const extra = [...selectedSet].filter((item) => !answerSet.has(item));
  if (missed.length === 0 && extra.length === 0) return "选择完整正确。";
  const messages = [];
  if (missed.length) messages.push(`漏选：${missed.join("、")}`);
  if (extra.length) messages.push(`错选：${extra.join("、")}`);
  return messages.join("；");
}

async function essayHistoryHtml(questionId: string): Promise<string> {
  const attempts = (await getAttemptsByQuestion(questionId)).slice(-5).reverse();
  if (attempts.length === 0) return "";
  return `
    <div>
      <strong>历史作答</strong>
      <div class="list" style="margin-top:10px">
        ${attempts
          .map(
            (attempt) => `
          <div class="row">
            <div class="row-main">
              <strong>${attempt.correct ? "已掌握" : "未掌握"}</strong>
              <span class="meta">${new Date(attempt.createdAt).toLocaleString()} · ${secondsLabel(attempt.durationSeconds)}</span>
              <p class="meta">${escapeHtml(attempt.textAnswer || "未填写")}</p>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

async function selectOption(value: string): Promise<void> {
  const state = await getState();
  const session = state.currentSession;
  if (!session) return;
  const question = await getQuestion(session.questionIds[session.index]);
  if (!question || !draft || draft.submitted) return;

  if (question.type === "multiple") {
    draft.selected = draft.selected.includes(value) ? draft.selected.filter((item) => item !== value) : [...draft.selected, value];
    renderPractice();
    return;
  }

  draft.selected = [value];
  draft.correct = isCorrect(question, draft.selected);
  draft.submitted = true;
  await recordAttempt(question, draft.selected, "", draft.correct, false);
  renderPractice();
}

async function submitObjective(): Promise<void> {
  const state = await getState();
  const session = state.currentSession;
  if (!session || !draft) return;
  const question = await getQuestion(session.questionIds[session.index]);
  if (!question) return;
  if (draft.selected.length === 0) {
    showToast("请先选择答案。");
    return;
  }
  draft.correct = isCorrect(question, draft.selected);
  draft.submitted = true;
  await recordAttempt(question, draft.selected, "", draft.correct, false);
  renderPractice();
}

async function submitEssay(): Promise<void> {
  if (!draft) return;
  const textarea = document.querySelector<HTMLTextAreaElement>("#essayText");
  draft.textAnswer = textarea?.value.trim() ?? "";
  draft.submitted = true;
  draft.correct = null;
  renderPractice();
}

async function markEssay(correct: boolean): Promise<void> {
  const state = await getState();
  const session = state.currentSession;
  if (!session || !draft) return;
  const question = await getQuestion(session.questionIds[session.index]);
  if (!question) return;
  draft.correct = correct;
  await recordAttempt(question, [], draft.textAnswer, correct, true);
  renderPractice();
}

async function renderCollection(kind: "wrong" | "favorite" | "essay"): Promise<void> {
  const [state, questions] = await Promise.all([getState(), getQuestions()]);
  let rows =
    kind === "wrong"
      ? questions.filter((question) => state.wrongIds.includes(question.id))
      : kind === "favorite"
        ? questions.filter((question) => state.favoriteIds.includes(question.id))
        : questions.filter((question) => question.type === "essay");

  if (kind === "wrong" && wrongTypeFilter !== "all") rows = rows.filter((question) => question.type === wrongTypeFilter);

  const title = kind === "wrong" ? "错题本" : kind === "favorite" ? "收藏夹" : "解答题专项";
  app.innerHTML = shell(`
    ${backHeader(title, `${rows.length} 道题`)}
    ${
      kind === "wrong"
        ? `<section class="panel"><div class="field"><label for="wrongFilter">按题型筛选</label><select id="wrongFilter" data-action="wrong-filter">
            <option value="all">全部题型</option>
            <option value="single">单选题</option>
            <option value="multiple">多选题</option>
            <option value="judge">判断题</option>
            <option value="essay">解答题</option>
          </select></div></section>`
        : ""
    }
    <section class="panel">
      <div class="list">
        ${
          rows.length
            ? rows
                .map(
                  (question) => `
            <div class="row">
              <div class="row-main">
                <strong>${escapeHtml(question.question)}</strong>
                <span class="meta">${typeLabel[question.type]} · ${escapeHtml(question.chapter)}</span>
              </div>
              <button class="secondary-button" data-action="${kind === "wrong" ? "mastered" : "practice-one"}" data-id="${question.id}">
                ${kind === "wrong" ? "已掌握" : "练习"}
              </button>
            </div>
          `
                )
                .join("")
            : `<div class="empty">这里暂时没有题目。</div>`
        }
      </div>
    </section>
    ${
      rows.length
        ? `<button class="primary-button" data-action="${kind === "wrong" ? "start-wrong" : kind === "favorite" ? "start-favorite" : "start-essay"}">开始练习</button>`
        : ""
    }
  `);

  const select = document.querySelector<HTMLSelectElement>("#wrongFilter");
  if (select) select.value = wrongTypeFilter;
}

async function practiceOne(questionId: string): Promise<void> {
  const state = await getState();
  await saveState({
    ...state,
    currentSession: {
      mode: "sequential",
      questionIds: [questionId],
      index: 0,
      startedAt: new Date().toISOString()
    }
  });
  route = "practice";
  renderPractice();
}

async function renderStats(): Promise<void> {
  const [state, attempts] = await Promise.all([getState(), getAttempts()]);
  const todayCount = attempts.filter((attempt) => attempt.createdAt.slice(0, 10) === dateKey()).length;
  const trend = lastSevenDays(attempts, state);
  const maxCount = Math.max(1, ...trend.map((item) => item.count));
  const summaries = typeSummaries(attempts);

  app.innerHTML = shell(`
    ${backHeader("学习统计", "所有统计均保存在本地")}
    <section class="stats-grid">
      <div class="stat"><strong>${attempts.length}</strong><span class="meta">总答题数</span></div>
      <div class="stat"><strong>${correctRate(attempts)}%</strong><span class="meta">正确率</span></div>
      <div class="stat"><strong>${todayCount}</strong><span class="meta">今日完成</span></div>
      <div class="stat"><strong>${streakDays(attempts)}</strong><span class="meta">连续学习天数</span></div>
      <div class="stat"><strong>${state.wrongIds.length}</strong><span class="meta">错题数量</span></div>
      <div class="stat"><strong>${state.favoriteIds.length}</strong><span class="meta">收藏数量</span></div>
    </section>
    <section class="panel">
      <strong>各题型正确率</strong>
      <div class="list" style="margin-top:10px">
        ${summaries
          .map((item) => {
            const rate = item.total ? Math.round((item.correct / item.total) * 100) : 0;
            return `<div class="row"><div class="row-main"><strong>${typeLabel[item.type]}</strong><span class="meta">${item.correct}/${item.total}</span></div><strong>${rate}%</strong></div>`;
          })
          .join("")}
      </div>
    </section>
    <section class="panel">
      <strong>最近 7 天趋势</strong>
      <div class="trend" style="margin-top:14px">
        ${trend
          .map(
            (item) => `
          <div class="trend-item">
            <div class="trend-bar" style="height:${Math.max(8, (item.count / maxCount) * 82)}px"></div>
            <span>${item.date}</span>
            <span>${item.count}题</span>
          </div>
        `
          )
          .join("")}
      </div>
      <p class="meta">今日学习时长：${secondsLabel(state.dailySeconds[dateKey()] ?? 0)}</p>
    </section>
  `);
}

async function handleClick(event: MouseEvent): Promise<void> {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  const value = target.dataset.value;

  if (action === "home") setRoute("home");
  if (action === "theme") {
    const state = await getState();
    const nextTheme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    await saveState({ ...state, theme: nextTheme });
    render();
  }
  if (action === "resume") setRoute("practice");
  if (action === "import") setRoute("import");
  if (action === "stats") setRoute("stats");
  if (action === "wrong") setRoute("wrong");
  if (action === "favorite") setRoute("favorite");
  if (action === "start-sequential") startSession("sequential");
  if (action === "start-random") startSession("random");
  if (action === "start-wrong") startSession("wrong");
  if (action === "start-favorite") startSession("favorite");
  if (action === "start-essay") startSession("essay");
  if (action === "import-bank") importBank();
  if (action === "import-bundled") {
    const ok = await importBundledBank();
    showToast(ok ? "内置题库已导入。" : "内置题库加载失败，请刷新后重试。");
    render();
  }
  if (action === "export-all") exportAll(false);
  if (action === "export-banks") exportAll(true);
  if (action === "restore-backup") restoreBackup();
  if (action === "select-option" && value) selectOption(value);
  if (action === "submit-objective") submitObjective();
  if (action === "submit-essay") submitEssay();
  if (action === "essay-correct") markEssay(true);
  if (action === "essay-wrong") markEssay(false);
  if (action === "prev") moveQuestion(-1);
  if (action === "next") moveQuestion(1);
  if (action === "jump") jumpQuestion();
  if (action === "favorite-toggle" && id) toggleFavorite(id);
  if (action === "mastered" && id) markMastered(id);
  if (action === "practice-one" && id) practiceOne(id);
}

async function handleChange(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLSelectElement && target.id === "wrongFilter") {
    wrongTypeFilter = target.value as QuestionType | "all";
    renderCollection("wrong");
  }
}

async function render(): Promise<void> {
  if (route === "home") await renderHome();
  if (route === "import") await renderImport();
  if (route === "practice") await renderPractice();
  if (route === "wrong") await renderCollection("wrong");
  if (route === "favorite") await renderCollection("favorite");
  if (route === "essay") await renderCollection("essay");
  if (route === "stats") await renderStats();
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL || "./";
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {
      // Service Worker 注册失败不影响本地题库和做题功能。
    });
  });
}

document.addEventListener("click", (event) => {
  handleClick(event).catch((error) => showToast(error instanceof Error ? error.message : "操作失败"));
});
document.addEventListener("change", (event) => {
  handleChange(event).catch(() => showToast("操作失败"));
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => render());
registerServiceWorker();
render();
