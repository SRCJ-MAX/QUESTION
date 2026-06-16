import type { AppState, Attempt, Question, QuestionBank } from "./types";

const DB_NAME = "iphone-question-pwa";
const DB_VERSION = 1;
const STATE_KEY = "app-state";

let dbPromise: Promise<IDBDatabase> | null = null;

const defaultState: AppState = {
  favoriteIds: [],
  wrongIds: [],
  masteredIds: [],
  currentSession: null,
  theme: "system",
  dailySeconds: {},
  lastStudyDate: ""
};

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("banks")) {
        db.createObjectStore("banks", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("questions")) {
        const store = db.createObjectStore("questions", { keyPath: "id" });
        store.createIndex("bankId", "bankId");
        store.createIndex("type", "type");
      }

      if (!db.objectStoreNames.contains("attempts")) {
        const store = db.createObjectStore("attempts", { keyPath: "id" });
        store.createIndex("questionId", "questionId");
        store.createIndex("createdAt", "createdAt");
      }

      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = run(store);

        if (request) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } else {
          transaction.oncomplete = () => resolve();
        }

        transaction.onerror = () => reject(transaction.error);
      })
  );
}

function getAllFromIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).index(indexName).getAll(value);
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      })
  );
}

export async function getState(): Promise<AppState> {
  const row = await tx<{ key: string; value: AppState }>("meta", "readonly", (store) => store.get(STATE_KEY));
  return { ...defaultState, ...(row?.value ?? {}) };
}

export async function saveState(nextState: AppState): Promise<void> {
  await tx("meta", "readwrite", (store) => store.put({ key: STATE_KEY, value: nextState }));
}

export async function updateState(mutator: (state: AppState) => AppState): Promise<AppState> {
  const state = await getState();
  const nextState = mutator(state);
  await saveState(nextState);
  return nextState;
}

export async function addBank(bank: QuestionBank, questions: Question[]): Promise<void> {
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["banks", "questions"], "readwrite");
    transaction.objectStore("banks").put(bank);
    const questionStore = transaction.objectStore("questions");
    questions.forEach((question) => questionStore.put(question));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function getBanks(): Promise<QuestionBank[]> {
  return tx<QuestionBank[]>("banks", "readonly", (store) => store.getAll()).then((rows) => rows ?? []);
}

export function getQuestions(): Promise<Question[]> {
  return tx<Question[]>("questions", "readonly", (store) => store.getAll()).then((rows) => rows ?? []);
}

export function getQuestionsByBank(bankId: string): Promise<Question[]> {
  return getAllFromIndex<Question>("questions", "bankId", bankId);
}

export function getQuestion(id: string): Promise<Question | undefined> {
  return tx<Question>("questions", "readonly", (store) => store.get(id)) as Promise<Question | undefined>;
}

export function addAttempt(attempt: Attempt): Promise<void> {
  return tx("attempts", "readwrite", (store) => store.put(attempt)).then(() => undefined);
}

export function getAttempts(): Promise<Attempt[]> {
  return tx<Attempt[]>("attempts", "readonly", (store) => store.getAll()).then((rows) => rows ?? []);
}

export function getAttemptsByQuestion(questionId: string): Promise<Attempt[]> {
  return getAllFromIndex<Attempt>("attempts", "questionId", questionId);
}

export async function replaceAllData(payload: { banks: QuestionBank[]; questions: Question[]; attempts: Attempt[]; state: AppState }): Promise<void> {
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["banks", "questions", "attempts", "meta"], "readwrite");
    ["banks", "questions", "attempts", "meta"].forEach((name) => transaction.objectStore(name).clear());
    payload.banks.forEach((bank) => transaction.objectStore("banks").put(bank));
    payload.questions.forEach((question) => transaction.objectStore("questions").put(question));
    payload.attempts.forEach((attempt) => transaction.objectStore("attempts").put(attempt));
    transaction.objectStore("meta").put({ key: STATE_KEY, value: payload.state });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
