
import Editor from "@monaco-editor/react";
import type { SharedFile } from "../protocol";

interface CodeViewerProps {
  file: SharedFile | null;
}

function detectLanguage(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();

  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    html: "html",
    css: "css",
    scss: "scss",
    py: "python",
    java: "java",
    php: "php",
    sql: "sql",
    md: "markdown",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    ps1: "powershell",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    go: "go",
    rs: "rust"
  };

  return languages[extension ?? ""] ?? "plaintext";
}

export function CodeViewer({ file }: CodeViewerProps) {
  if (!file) {
    return (
      <div className="editor-empty">
        <h2>Aucun fichier sélectionné</h2>
        <p>
          Sélectionne un fichier dans l'explorateur
          pour afficher son contenu.
        </p>
      </div>
    );
  }

  return (
    <div className="editor-wrapper">
      <div className="editor-file-header">
        <span>{file.path}</span>
        <span>Version {file.version}</span>
      </div>

      <div className="editor-content">
        <Editor
          path={file.path}
          language={detectLanguage(file.path)}
          value={file.content}
          theme="vs-dark"
          loading="Chargement de Monaco..."
          options={{
            readOnly: true,
            domReadOnly: true,
            automaticLayout: true,
            minimap: {
              enabled: false
            },
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            folding: true,
            renderWhitespace: "selection",
            padding: {
              top: 16,
              bottom: 16
            }
          }}
        />
      </div>
    </div>
  );
}
