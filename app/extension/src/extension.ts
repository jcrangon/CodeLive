import * as vscode from "vscode";

import { saveAdminKey, getServerUrl } from "./configuration";

import { SharingController } from "./sharing";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeLive");

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  const controller = new SharingController(context, status, output);

  status.show();

  function command(name: string, callback: () => Promise<void>): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(name, async () => {
        try {
          await callback();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          output.appendLine(`ERREUR : ${message}`);

          vscode.window.showErrorMessage(`CodeLive : ${message}`);
        }
      }),
    );
  }

  command("codelive.configureServer", async () => {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "codelive.serverUrl",
    );
  });

  command("codelive.configureAdminKey", async () => {
    await saveAdminKey(context);
  });

  command("codelive.start", async () => {
    await controller.start();
  });

  command("codelive.copyLink", async () => {
    await controller.copyLink();
  });

  command("codelive.stop", async () => {
    await controller.stop();
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) {
        controller.onDocumentChanged(event.document);
      }
    }),
  );

  context.subscriptions.push(
    {
      dispose: () => controller.dispose(),
    },
    status,
    output,
  );

  output.appendLine("CodeLive activé.");

  try {
    output.appendLine(`Serveur configuré : ${getServerUrl()}`);
  } catch (error) {
    output.appendLine(`Configuration à vérifier : ${String(error)}`);
  }
}

export function deactivate(): void {
  // Le contrôleur est libéré par les subscriptions
  // de l'ExtensionContext.
}
