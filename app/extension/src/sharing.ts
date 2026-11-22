import * as vscode from "vscode";
import WebSocket from "ws";
import * as path from "node:path";

import {
  getAdminKey,
  getServerUrl,
  getStudentWebUrl,
  getSyncDelay,
} from "./configuration";

type SelectedFile = {
  uri: vscode.Uri;
  relativePath: string;
};

type ActiveSession = {
  id: string;
  link: string;
  socket: WebSocket;
  files: Map<string, SelectedFile>;
  timers: Map<string, NodeJS.Timeout>;
  stopping: boolean;
};

const MAX_FILES = 100;
const MAX_CONTENT_BYTES = 180_000;

// Blocage de quelques noms de fichiers sensibles.
// Ce filtre est une protection de base, pas un scanner
// exhaustif de secrets.
function isSensitiveFile(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, "/").toLowerCase().split("/");

  const name = parts.at(-1) ?? "";

  return (
    parts.some((part) => [".git", "node_modules", ".ssh"].includes(part)) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx") ||
    name === "credentials.json" ||
    name === "secrets.json"
  );
}

async function selectFiles(): Promise<SelectedFile[]> {
  const folders = vscode.workspace.workspaceFolders;

  if (!folders || folders.length !== 1) {
    throw new Error("Ouvre un dossier de projet unique dans VS Code.");
  }

  const root = folders[0].uri;

  if (root.scheme !== "file") {
    throw new Error("Le MVP prend en charge les dossiers locaux uniquement.");
  }

  const selected = await vscode.window.showOpenDialog({
    title: "CodeLive — Sélectionner les fichiers à partager",
    defaultUri: root,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    openLabel: "Partager ces fichiers",
  });

  if (!selected) return [];

  if (selected.length > MAX_FILES) {
    throw new Error(`Maximum ${MAX_FILES} fichiers par session.`);
  }

  const result: SelectedFile[] = [];

  for (const uri of selected) {
    if (uri.scheme !== "file") {
      throw new Error("Fichier non local sélectionné.");
    }

    const relativePath = path
      .relative(root.fsPath, uri.fsPath)
      .replace(/\\/g, "/");

    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Fichier hors du projet : ${uri.fsPath}`);
    }

    if (isSensitiveFile(relativePath)) {
      throw new Error(`Fichier sensible interdit : ${relativePath}`);
    }

    result.push({ uri, relativePath });
  }

  return result;
}

function connectTeacher(wsUrl: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, {
      handshakeTimeout: 8000,
      maxPayload: 262144,
    });

    const timeout = setTimeout(() => {
      fail(new Error("Authentification expirée."));
    }, 8000);

    let settled = false;

    function cleanup() {
      clearTimeout(timeout);
      socket.off("open", onOpen);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      socket.on("error", () => {});
      socket.terminate();
      reject(error);
    }

    function onOpen() {
      socket.send(
        JSON.stringify({
          type: "teacher:auth",
          token,
        }),
      );
    }

    function onMessage(data: WebSocket.RawData) {
      let message: {
        type?: string;
        role?: string;
        message?: string;
      };

      try {
        message = JSON.parse(data.toString());
      } catch {
        fail(new Error("Réponse serveur invalide."));
        return;
      }

      if (message.type === "session:connected" && message.role === "teacher") {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(socket);
        return;
      }

      if (message.type === "error") {
        fail(new Error(message.message ?? "Accès refusé."));
      }
    }

    function onError(error: Error) {
      fail(error);
    }

    function onClose() {
      fail(new Error("Connexion fermée avant authentification."));
    }

    socket.on("open", onOpen);
    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

export class SharingController {
  private active: ActiveSession | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly status: vscode.StatusBarItem,
    private readonly output: vscode.OutputChannel,
  ) {
    this.updateStatus();
  }

  private updateStatus(): void {
    if (this.active) {
      this.status.text = "$(broadcast) CodeLive LIVE";
      this.status.tooltip =
        `Session : ${this.active.id}\n` + "Cliquer pour arrêter le partage";
      this.status.command = "codelive.stop";
    } else {
      this.status.text = "$(circle-outline) CodeLive";
      this.status.tooltip = "Cliquer pour démarrer un partage";
      this.status.command = "codelive.start";
    }
  }

  private sendFile(
    session: ActiveSession,
    file: SelectedFile,
    content: string,
  ): void {
    if (session.stopping || session.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = JSON.stringify({
      type: "file:update",
      path: file.relativePath,
      content,
    });

    if (Buffer.byteLength(message, "utf8") > MAX_CONTENT_BYTES) {
      this.output.appendLine(
        `Fichier trop volumineux ignoré : ${file.relativePath}`,
      );
      return;
    }

    session.socket.send(message, (error) => {
      if (error) {
        this.output.appendLine(
          `Erreur d'envoi (${file.relativePath}) : ${error.message}`,
        );
      }
    });
  }

  private async sendInitialFiles(session: ActiveSession): Promise<void> {
    for (const file of session.files.values()) {
      const document = await vscode.workspace.openTextDocument(file.uri);

      this.sendFile(session, file, document.getText());
    }
  }

  async start(): Promise<void> {
    if (this.active) {
      vscode.window.showWarningMessage("Une session CodeLive est déjà active.");
      return;
    }

    if (!vscode.workspace.isTrusted) {
      throw new Error(
        "Le dossier doit être approuvé dans VS Code avant le partage.",
      );
    }

    const serverUrl = getServerUrl();
    const studentWebUrl = getStudentWebUrl();

    let adminKey = await getAdminKey(this.context);

    if (!adminKey) {
      const action = await vscode.window.showInformationMessage(
        "Configure d'abord ta clé d'accès CodeLive.",
        "Configurer",
      );

      if (action !== "Configurer") return;

      await vscode.commands.executeCommand("codelive.configureAdminKey");

      adminKey = await getAdminKey(this.context);
      if (!adminKey) return;
    }

    const files = await selectFiles();

    if (files.length === 0) {
      return;
    }

    // On indique explicitement les fichiers à publier.
    const confirmation = await vscode.window.showWarningMessage(
      `Partager ${files.length} fichier(s) sur ${serverUrl} ? ` +
        "Leur contenu, y compris les modifications non enregistrées, " +
        "sera visible par toute personne possédant le lien.",
      { modal: true },
      "Démarrer le partage",
    );

    if (confirmation !== "Démarrer le partage") {
      return;
    }

    const response = await fetch(`${serverUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "x-admin-key": adminKey,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Création de session refusée (HTTP ${response.status}).`);
    }

    const data: unknown = await response.json();

    if (
      typeof data !== "object" ||
      data === null ||
      !("id" in data) ||
      !("teacherToken" in data) ||
      typeof data.id !== "string" ||
      typeof data.teacherToken !== "string"
    ) {
      throw new Error("Réponse de session invalide.");
    }

    const wsUrl = new URL(serverUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.pathname = `/ws/${encodeURIComponent(data.id)}`;

    const socket = await connectTeacher(wsUrl.toString(), data.teacherToken);

    const studentUrl = new URL(studentWebUrl);
    studentUrl.searchParams.set("session", data.id);

    const session: ActiveSession = {
      id: data.id,
      link: studentUrl.toString(),
      socket,
      files: new Map(files.map((file) => [file.uri.toString(), file])),
      timers: new Map(),
      stopping: false,
    };

    this.active = session;
    this.updateStatus();

    socket.on("error", (error) => {
      this.output.appendLine(`WebSocket : ${error.message}`);
    });

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        if (message.type === "error") {
          this.output.appendLine(`Serveur : ${message.message}`);
          vscode.window.showWarningMessage(`CodeLive : ${message.message}`);
        }
      } catch {
        this.output.appendLine("Message serveur non reconnu.");
      }
    });

    socket.on("close", () => {
      this.clearSession(session);

      if (!session.stopping) {
        vscode.window.showWarningMessage(
          "CodeLive : connexion perdue. " + "La synchronisation est arrêtée.",
        );
      }
    });

    await this.sendInitialFiles(session);

    await vscode.env.clipboard.writeText(session.link);

    this.output.appendLine(`Session créée : ${session.id}`);

    this.output.appendLine(`Lien étudiant : ${session.link}`);

    const action = await vscode.window.showInformationMessage(
      `CodeLive actif — ${files.length} fichier(s). ` + "Lien étudiant copié.",
      "Ouvrir le lien",
    );

    if (action === "Ouvrir le lien") {
      await vscode.env.openExternal(vscode.Uri.parse(session.link));
    }
  }

  onDocumentChanged(document: vscode.TextDocument): void {
    const session = this.active;

    if (!session || session.stopping) return;

    const key = document.uri.toString();
    const file = session.files.get(key);

    if (!file) return;

    const existingTimer = session.timers.get(key);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      session.timers.delete(key);

      if (this.active !== session) return;

      this.sendFile(session, file, document.getText());
    }, getSyncDelay());

    session.timers.set(key, timer);
  }

  async copyLink(): Promise<void> {
    if (!this.active) {
      vscode.window.showInformationMessage("Aucune session CodeLive active.");
      return;
    }

    await vscode.env.clipboard.writeText(this.active.link);

    vscode.window.showInformationMessage(
      "Lien étudiant copié dans le presse-papiers.",
    );
  }

  async stop(): Promise<void> {
    const session = this.active;

    if (!session) {
      vscode.window.showInformationMessage("Aucune session à arrêter.");
      return;
    }

    session.stopping = true;

    this.clearSession(session);

    if (session.socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        session.socket.send(
          JSON.stringify({
            type: "session:stop",
          }),
          () => {
            session.socket.close();
            resolve();
          },
        );
      });
    } else {
      session.socket.terminate();
    }

    vscode.window.showInformationMessage("CodeLive : partage arrêté.");
  }

  private clearSession(session: ActiveSession): void {
    for (const timer of session.timers.values()) {
      clearTimeout(timer);
    }

    session.timers.clear();

    if (this.active === session) {
      this.active = undefined;
      this.updateStatus();
    }
  }

  dispose(): void {
    const session = this.active;

    if (session) {
      session.stopping = true;
      this.clearSession(session);

      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({ type: "session:stop" }), () =>
          session.socket.close(),
        );
      } else {
        session.socket.terminate();
      }
    }
  }
}
