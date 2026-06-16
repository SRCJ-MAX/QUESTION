import type { AppState, Attempt, QuestionType, TypeSummary } from "./types";

export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function sameDay(iso: string, day = dateKey()): boolean {
  return iso.slice(0, 10) === day;
}

export function correctRate(attempts: Attempt[]): number {
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.correct).length / attempts.length) * 100);
}

export function streakDays(attempts: Attempt[]): number {
  const days = new Set(attempts.map((attempt) => attempt.createdAt.slice(0, 10)));
  let streak = 0;
  const cursor = new Date();

  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function lastSevenDays(attempts: Attempt[], state: AppState): Array<{ date: string; count: number; seconds: number }> {
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - offset));
    const key = dateKey(day);
    return {
      date: key.slice(5),
      count: attempts.filter((attempt) => sameDay(attempt.createdAt, key)).length,
      seconds: state.dailySeconds[key] ?? 0
    };
  });
}

export function typeSummaries(attempts: Attempt[]): TypeSummary[] {
  const types: QuestionType[] = ["single", "multiple", "judge", "essay"];
  return types.map((type) => {
    const rows = attempts.filter((attempt) => attempt.type === type);
    return {
      type,
      total: rows.length,
      correct: rows.filter((attempt) => attempt.correct).length
    };
  });
}

export function secondsLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}
