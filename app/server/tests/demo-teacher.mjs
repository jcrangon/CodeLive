import assert from "node:assert/strict";

const API = "http://127.0.0.1:3000";
const WEB = "http://127.0.0.1:5173";
const ADMIN_KEY = "codelive-cle-locale-test-2026";

const response = await fetch(`${API}/api/sessions`, {
  method: "POST",
  headers: {
    "x-admin-key": ADMIN_KEY,
  },
});

assert.equal(response.status, 201, "Impossible de créer une session");

const session = await response.json();

console.log("\n=== CodeLive — Démonstration ===");
console.log("Session :", session.id);

console.log("\nLien étudiant :", `${WEB}/?session=${session.id}`);

const socket = new WebSocket(`ws://127.0.0.1:3000/ws/${session.id}`);

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, {
    once: true,
  });

  socket.addEventListener("error", reject, {
    once: true,
  });
});

const authPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.removeEventListener("message", handler);
    reject(new Error("Authentification expirée"));
  }, 5000);

  function handler(event) {
    const message = JSON.parse(event.data);

    if (message.type === "session:connected" && message.role === "teacher") {
      clearTimeout(timeout);
      socket.removeEventListener("message", handler);
      resolve();
    }

    if (message.type === "error") {
      clearTimeout(timeout);
      socket.removeEventListener("message", handler);
      reject(new Error(message.message));
    }
  }

  socket.addEventListener("message", handler);
});

socket.send(
  JSON.stringify({
    type: "teacher:auth",
    token: session.teacherToken,
  }),
);

await authPromise;

console.log("Formateur authentifié");

function sendFile(path, content) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(
    JSON.stringify({
      type: "file:update",
      path,
      content,
    }),
  );

  console.log("Fichier envoyé :", path);
}

// Deux fichiers initiaux.
sendFile(
  "src/types.ts",
  `export interface User {
  id: number;
  name: string;
  email: string;
}`,
);

let counter = 0;

function publishUpdate() {
  counter++;

  const content = `import type { User } from "./types";

const user: User = {
  id: ${counter},
  name: "Alice",
  email: "alice@example.com"
};

console.log("Modification numéro ${counter}");
console.log(user);
`;

  sendFile("src/main.ts", content);
}

publishUpdate();

const interval = setInterval(publishUpdate, 3000);

function shutdown() {
  clearInterval(interval);

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "session:stop",
      }),
    );
  }

  setTimeout(() => {
    socket.close();
    process.exit(0);
  }, 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

socket.addEventListener("close", () => {
  clearInterval(interval);
  console.log("Connexion fermée");
});
