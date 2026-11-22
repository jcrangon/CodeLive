import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import type { SharedFile } from "./protocol.js";

export interface Session {
  id: string;
  teacherToken: string;
  files: Map<string, SharedFile>;
  students: Set<WebSocket>;
  teacher: WebSocket | null;
}

const sessions = new Map<string, Session>();

export function createSession(): Session {
  const id = randomBytes(6).toString("hex");

  const teacherToken = randomBytes(32).toString("hex");

  const session: Session = {
    id,
    teacherToken,
    files: new Map(),
    students: new Set(),
    teacher: null,
  };

  sessions.set(id, session);

  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): void {
  sessions.delete(id);
}
