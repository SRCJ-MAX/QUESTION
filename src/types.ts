export type QuestionType = "single" | "multiple" | "judge" | "essay";

export interface Question {
  id: string;
  bankId: string;
  type: QuestionType;
  question: string;
  options: string[];
  answer: string[];
  analysis: string;
  chapter: string;
  createdAt: string;
}

export interface QuestionBank {
  id: string;
  title: string;
  count: number;
  createdAt: string;
}

export interface Attempt {
  id: string;
  questionId: string;
  bankId: string;
  type: QuestionType;
  selected: string[];
  textAnswer: string;
  correct: boolean;
  selfMarked: boolean;
  durationSeconds: number;
  createdAt: string;
}

export interface PracticeSession {
  mode: "sequential" | "random" | "wrong" | "favorite" | "essay";
  questionIds: string[];
  index: number;
  bankId?: string;
  startedAt: string;
}

export interface AppState {
  favoriteIds: string[];
  wrongIds: string[];
  masteredIds: string[];
  currentSession: PracticeSession | null;
  theme: "light" | "dark" | "system";
  dailySeconds: Record<string, number>;
  lastStudyDate: string;
}

export interface ImportResult {
  bank: QuestionBank;
  questions: Question[];
}

export interface TypeSummary {
  type: QuestionType;
  total: number;
  correct: number;
}
