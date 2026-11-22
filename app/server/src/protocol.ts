export type SharedFile = {
  path: string;
  content: string;
  version: number;
};

export type ClientMessage =
  | {
      type: "teacher:auth";
      token: string;
    }
  | {
      type: "file:update";
      path: string;
      content: string;
    }
  | {
      type: "session:stop";
    };

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
