export interface SharedFile {
  path: string;
  content: string;
  version: number;
}

export type ServerMessage =
  | {
      type: "session:connected";
      role: "student" | "teacher";
    }
  | {
      type: "session:snapshot";
      files: SharedFile[];
    }
  | {
      type: "file:updated";
      file: SharedFile;
    }
  | {
      type: "session:stopped";
    }
  | {
      type: "error";
      message: string;
    };

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped"
  | "error";
