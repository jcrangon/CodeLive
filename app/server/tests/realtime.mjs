import assert from "node:assert/strict";

const baseUrl = "http://127.0.0.1:3000";
const adminKey = "codelive-cle-locale-test-2026";

const TIMEOUT = 5000;

// =====================================================
// OUTILS
// =====================================================

function waitForMessage(socket, expectedType, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Délai dépassé : ${expectedType}`));
    }, TIMEOUT);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("message", handler);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    }

    function handler(event) {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "error") {
        cleanup();
        reject(new Error(`Erreur serveur : ${JSON.stringify(message)}`));
        return;
      }

      if (message.type === expectedType && predicate(message)) {
        cleanup();
        resolve(message);
      }
    }

    function onClose() {
      cleanup();
      reject(new Error(`WebSocket fermé avant réception de ${expectedType}`));
    }

    function onError() {
      cleanup();
      reject(new Error(`Erreur WebSocket en attendant ${expectedType}`));
    }

    socket.addEventListener("message", handler);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  });
}

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Connexion WebSocket expirée"));
    }, TIMEOUT);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    }

    function onOpen() {
      cleanup();
      resolve();
    }

    function onError() {
      cleanup();
      reject(new Error("Connexion WebSocket impossible"));
    }

    function onClose() {
      cleanup();
      reject(new Error("Connexion WebSocket fermée"));
    }

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

// =====================================================
// TEST PRINCIPAL
// =====================================================

async function main() {
  let student;
  let teacher;

  try {
    // -------------------------------------------------
    // 1. Création de session
    // -------------------------------------------------

    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "x-admin-key": adminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    assert.equal(
      response.status,
      201,
      `Création de session refusée : HTTP ${response.status}`,
    );

    const session = await response.json();

    assert.ok(session.id);
    assert.ok(session.teacherToken);

    console.log("Session créée :", session.id);

    const wsUrl = `ws://127.0.0.1:3000/ws/${session.id}`;

    // -------------------------------------------------
    // 2. Connexion étudiant
    // -------------------------------------------------

    student = new WebSocket(wsUrl);

    const snapshotPromise = waitForMessage(student, "session:snapshot");

    await waitForOpen(student);

    const snapshot = await snapshotPromise;

    assert.deepEqual(snapshot.files, []);

    console.log("Étudiant connecté");

    // -------------------------------------------------
    // 3. Connexion formateur
    // -------------------------------------------------

    teacher = new WebSocket(wsUrl);

    await waitForOpen(teacher);

    // IMPORTANT :
    // On attend explicitement le rôle teacher.
    // Un message initial avec role=student
    // ne doit pas valider l'authentification.

    const authenticated = waitForMessage(
      teacher,
      "session:connected",
      (message) => message.role === "teacher",
    );

    teacher.send(
      JSON.stringify({
        type: "teacher:auth",
        token: session.teacherToken,
      }),
    );

    const result = await authenticated;

    assert.equal(result.role, "teacher");

    console.log("Formateur authentifié");

    // -------------------------------------------------
    // 4. Transmission d'une modification
    // -------------------------------------------------

    const received = waitForMessage(student, "file:updated");

    const expectedContent = "console.log('Bonjour CodeLive');";

    teacher.send(
      JSON.stringify({
        type: "file:update",
        path: "src/main.ts",
        content: expectedContent,
      }),
    );

    const update = await received;

    assert.equal(update.file.path, "src/main.ts");

    assert.equal(update.file.content, expectedContent);

    assert.equal(update.file.version, 1);

    console.log("Modification reçue :", update.file);

    console.log("TEST TEMPS RÉEL RÉUSSI");

    // -------------------------------------------------
    // 5. Fermeture de session
    // -------------------------------------------------

    const stopped = waitForMessage(student, "session:stopped");

    teacher.send(
      JSON.stringify({
        type: "session:stop",
      }),
    );

    await stopped;

    console.log("Session fermée correctement");

    console.log("\nTOUS LES TESTS CODELIVE ONT RÉUSSI");
  } finally {
    // -------------------------------------------------
    // Nettoyage
    // -------------------------------------------------

    if (student && student.readyState !== WebSocket.CLOSED) {
      student.close();
    }

    if (teacher && teacher.readyState !== WebSocket.CLOSED) {
      teacher.close();
    }
  }
}

// =====================================================
// EXÉCUTION
// =====================================================

main().catch((error) => {
  console.error("\nÉCHEC DU TEST CODELIVE");
  console.error(error);
  process.exitCode = 1;
});
