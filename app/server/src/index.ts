import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";

import { createSession, getSession, removeSession } from "./sessions.js";

import type { ClientMessage, ServerMessage, SharedFile } from "./protocol.js";

const app = Fastify({ logger: true });

const port = Number(process.env.PORT ?? 3000);
const adminKey = process.env.CODELIVE_ADMIN_KEY;

if (!adminKey || adminKey.length < 16) {
  throw new Error("CODELIVE_ADMIN_KEY doit contenir au moins 16 caractères");
}

await app.register(websocket, {
  options: {
    maxPayload: 262144,
  },
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function matchesSecret(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

// Vérification du serveur
app.get("/health", async () => ({
  status: "ok",
  service: "codelive-server",
  version: "0.1.0",
}));

// Création d'une session par le formateur
app.post("/api/sessions", async (request, reply) => {
  const supplied = request.headers["x-admin-key"];

  if (typeof supplied !== "string" || !matchesSecret(supplied, adminKey)) {
    return reply.code(401).send({
      error: "Non autorisé",
    });
  }

  const session = createSession();

  return reply.code(201).send({
    id: session.id,
    teacherToken: session.teacherToken,
  });
});

// Connexion WebSocket à une session
app.get("/ws/:id", { websocket: true }, (socket, request) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);

  if (!session) {
    socket.close(1008, "Session introuvable");
    return;
  }

  let isTeacher = false;

  // Par défaut, tout nouveau client est étudiant.
  session.students.add(socket);

  send(socket, {
    type: "session:connected",
    role: "student",
  });

  send(socket, {
    type: "session:snapshot",
    files: [...session.files.values()],
  });

  socket.on("message", (raw) => {
    let message: ClientMessage;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, {
        type: "error",
        message: "JSON invalide",
      });
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    // Authentification du formateur
    if (message.type === "teacher:auth") {
      if (
        typeof message.token !== "string" ||
        !matchesSecret(message.token, session.teacherToken)
      ) {
        send(socket, {
          type: "error",
          message: "Token invalide",
        });
        return;
      }

      if (
        session.teacher &&
        session.teacher !== socket &&
        session.teacher.readyState === 1
      ) {
        send(socket, {
          type: "error",
          message: "Formateur déjà connecté",
        });
        return;
      }

      isTeacher = true;
      session.students.delete(socket);
      session.teacher = socket;

      send(socket, {
        type: "session:connected",
        role: "teacher",
      });

      return;
    }

    // Seul le formateur peut modifier le code.
    if (!isTeacher || session.teacher !== socket) {
      send(socket, {
        type: "error",
        message: "Action réservée au formateur",
      });
      return;
    }

    // Mise à jour d'un fichier
    if (message.type === "file:update") {
      if (
        typeof message.path !== "string" ||
        typeof message.content !== "string" ||
        message.path.length > 500 ||
        !message.path ||
        message.path.includes("\\") ||
        message.path.startsWith("/") ||
        message.path.split("/").some((part) => part === ".." || part === ".") ||
        message.content.length > 200000 ||
        (!session.files.has(message.path) && session.files.size >= 100)
      ) {
        send(socket, {
          type: "error",
          message: "Fichier invalide ou limite atteinte",
        });
        return;
      }

      const previous = session.files.get(message.path);

      const file: SharedFile = {
        path: message.path,
        content: message.content,
        version: (previous?.version ?? 0) + 1,
      };

      session.files.set(file.path, file);

      const event: ServerMessage = {
        type: "file:updated",
        file,
      };

      for (const student of session.students) {
        send(student, event);
      }

      return;
    }

    // Fermeture volontaire de la session
    if (message.type === "session:stop") {
      const event: ServerMessage = {
        type: "session:stopped",
      };

      for (const student of session.students) {
        send(student, event);
        student.close(1000, "Session terminée");
      }

      send(socket, event);

      removeSession(id);
      socket.close(1000, "Session terminée");
    }
  });

  socket.on("close", () => {
    session.students.delete(socket);

    if (session.teacher === socket) {
      session.teacher = null;
    }
  });

  socket.on("error", (error) => {
    app.log.warn({ error }, "Erreur WebSocket");
  });
});

try {
  await app.listen({
    port,
    host: "127.0.0.1",
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
