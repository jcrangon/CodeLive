import * as vscode from "vscode";

const SECRET_PREFIX = "codelive.adminKey:";

export function normalizeUrl(value: string): string {
  const url = new URL(value.trim());

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("L'URL doit utiliser HTTP ou HTTPS.");
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Indique uniquement l'origine du serveur, sans chemin ni identifiants.",
    );
  }

  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  if (url.protocol === "http:" && !isLocal) {
    throw new Error("Un serveur distant doit utiliser HTTPS.");
  }

  return url.origin;
}

export function getServerUrl(): string {
  const value = vscode.workspace
    .getConfiguration("codelive")
    .get<string>("serverUrl", "");

  return normalizeUrl(value);
}

export function getStudentWebUrl(): string {
  const value = vscode.workspace
    .getConfiguration("codelive")
    .get<string>("studentWebUrl", "");

  return normalizeUrl(value);
}

export function getSyncDelay(): number {
  const value = vscode.workspace
    .getConfiguration("codelive")
    .get<number>("syncDelay", 200);

  return Math.max(50, Math.min(2000, value));
}

export async function saveAdminKey(
  context: vscode.ExtensionContext,
): Promise<void> {
  const serverUrl = getServerUrl();

  const key = await vscode.window.showInputBox({
    title: "CodeLive — Clé d'accès",
    prompt: `Clé administrateur pour ${serverUrl}`,
    password: true,
    ignoreFocusOut: true,
    validateInput(value) {
      return value.length < 16
        ? "La clé doit contenir au moins 16 caractères."
        : null;
    },
  });

  if (key === undefined) return;

  await context.secrets.store(SECRET_PREFIX + serverUrl, key);

  vscode.window.showInformationMessage(
    "CodeLive : clé enregistrée dans SecretStorage.",
  );
}

export async function getAdminKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(SECRET_PREFIX + getServerUrl());
}
