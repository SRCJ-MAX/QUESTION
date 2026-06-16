import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import type { ImportResult, Question, QuestionType } from "./types";

type RawQuestion = Record<string, unknown>;

const typeMap: Record<string, QuestionType> = {
  single: "single",
  单选: "single",
  单选题: "single",
  multiple: "multiple",
  多选: "multiple",
  多选题: "multiple",
  judge: "judge",
  判断: "judge",
  判断题: "judge",
  truefalse: "judge",
  essay: "essay",
  subjective: "essay",
  解答: "essay",
  解答题: "essay",
  主观: "essay",
  主观题: "essay"
};

const headerAliases: Record<string, string[]> = {
  type: ["type", "题型", "类型"],
  question: ["question", "题目", "问题", "题干"],
  options: ["options", "选项"],
  answer: ["answer", "答案", "标准答案", "正确答案"],
  analysis: ["analysis", "解析", "详细解析", "说明"],
  chapter: ["chapter", "章节", "章", "分类", "知识点"]
};

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pick(row: RawQuestion, key: keyof typeof headerAliases): unknown {
  for (const alias of headerAliases[key]) {
    if (row[alias] !== undefined && row[alias] !== "") return row[alias];
  }
  return "";
}

function normalizeType(value: unknown, options: string[], answer: string[]): QuestionType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (typeMap[raw]) return typeMap[raw];
  if (answer.length > 1) return "multiple";
  if (options.length === 2 && options.some((item) => ["正确", "对", "true"].includes(item.toLowerCase()))) return "judge";
  return options.length > 0 ? "single" : "essay";
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/\r?\n|[;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text
    .split(/\r?\n|[;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionColumns(row: RawQuestion): string[] {
  return ["A", "B", "C", "D", "E", "F", "选项A", "选项B", "选项C", "选项D", "选项E", "选项F"]
    .map((key) => row[key])
    .filter((value) => value !== undefined && value !== "")
    .map(String)
    .map((item) => item.trim());
}

function normalizeJudgeOptions(type: QuestionType, options: string[]): string[] {
  if (type !== "judge") return options;
  return options.length > 0 ? options : ["正确", "错误"];
}

function buildQuestion(row: RawQuestion, bankId: string): Question | null {
  const manualOptions = splitList(pick(row, "options"));
  const options = manualOptions.length > 0 ? manualOptions : optionColumns(row);
  const answer = normalizeAnswer(pick(row, "answer"));
  const type = normalizeType(pick(row, "type"), options, answer);
  const question = String(pick(row, "question") ?? "").trim();

  if (!question) return null;

  return {
    id: id("q"),
    bankId,
    type,
    question,
    options: normalizeJudgeOptions(type, options),
    answer,
    analysis: String(pick(row, "analysis") ?? "").trim(),
    chapter: String(pick(row, "chapter") ?? "未分类").trim() || "未分类",
    createdAt: new Date().toISOString()
  };
}

function rowsToObjects(rows: unknown[][]): RawQuestion[] {
  const [headerRow, ...bodyRows] = rows;
  if (!headerRow) return [];
  const headers = headerRow.map((item) => String(item ?? "").trim());
  return bodyRows
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => {
      const object: RawQuestion = {};
      headers.forEach((header, index) => {
        if (header) object[header] = row[index] ?? "";
      });
      return object;
    });
}

function normalizeJsonText(text: string): string {
  return text
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");
}

async function parseJson(file: File): Promise<{ title: string; rows: RawQuestion[] }> {
  const text = await file.text();
  const data = JSON.parse(normalizeJsonText(text));
  if (Array.isArray(data)) return { title: file.name.replace(/\.json$/i, ""), rows: data };
  return { title: String(data.title ?? file.name.replace(/\.json$/i, "")), rows: data.questions ?? [] };
}

async function parseCsv(file: File): Promise<{ title: string; rows: RawQuestion[] }> {
  const text = await file.text();
  const result = Papa.parse<RawQuestion>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (result.errors.length > 0) {
    throw new Error(`CSV 解析失败：${result.errors[0].message}`);
  }

  return { title: file.name.replace(/\.csv$/i, ""), rows: result.data };
}

async function parseXlsx(file: File): Promise<{ title: string; rows: RawQuestion[] }> {
  const rows = (await readXlsxFile(file)) as unknown[][];
  return { title: file.name.replace(/\.xlsx$/i, ""), rows: rowsToObjects(rows) };
}

export async function parseQuestionBank(file: File): Promise<ImportResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const parsed =
    extension === "json" ? await parseJson(file) : extension === "csv" ? await parseCsv(file) : extension === "xlsx" ? await parseXlsx(file) : null;

  if (!parsed) throw new Error("暂不支持该文件类型，请导入 JSON、CSV 或 .xlsx 文件。");

  const bankId = id("bank");
  const questions = parsed.rows.map((row) => buildQuestion(row, bankId)).filter((item): item is Question => Boolean(item));

  if (questions.length === 0) throw new Error("没有识别到有效题目，请检查表头是否包含题目、答案等字段。");

  return {
    bank: {
      id: bankId,
      title: parsed.title || "未命名题库",
      count: questions.length,
      createdAt: new Date().toISOString()
    },
    questions
  };
}

export function backupToFile(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
