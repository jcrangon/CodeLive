
import { useState } from "react";
import { CodeViewer } from "./components/CodeViewer";
import { useCodeLive } from "./hooks/useCodeLive";
import type { SharedFile } from "./protocol";
import "./App.css";

// =====================================================
// RÉCUPÉRATION DE L'IDENTIFIANT DE SESSION
// =====================================================

function getSessionId(): string | null {
  const params = new URLSearchParams(
    window.location.search
  );

  return params.get("session");
}

// =====================================================
// APPLICATION
// =====================================================

export default function App() {
  const sessionId = getSessionId();

  // ---------------------------------------------------
  // CONNEXION AU SERVEUR CODELIVE
  // ---------------------------------------------------

  const {
    files,
    status,
    error,
    reconnect
  } = useCodeLive(sessionId);

  // ---------------------------------------------------
  // ÉTATS LOCAUX
  // ---------------------------------------------------

  const [selectedPath, setSelectedPath] =
    useState<string | null>(null);

  const [pausedFiles, setPausedFiles] =
    useState<SharedFile[] | null>(null);

  // ---------------------------------------------------
  // GESTION DU MODE PAUSE
  // ---------------------------------------------------

  const isPaused = pausedFiles !== null;

  // En pause : fichiers figés.
  // En direct : fichiers synchronisés avec le serveur.

  const visibleFiles = pausedFiles ?? files;

  // ---------------------------------------------------
  // SÉLECTION AUTOMATIQUE DU FICHIER
  // ---------------------------------------------------

  // On vérifie si le chemin sélectionné existe
  // encore dans les fichiers actuellement visibles.
  //
  // Sinon, on utilise automatiquement le premier
  // fichier disponible.
  //
  // Aucun useEffect ni setState n'est nécessaire.

  const effectiveSelectedPath =
    visibleFiles.some(
      (file) => file.path === selectedPath
    )
      ? selectedPath
      : (visibleFiles[0]?.path ?? null);

  // Fichier effectivement affiché dans CodeViewer.

  const selectedFile =
    visibleFiles.find(
      (file) => file.path === effectiveSelectedPath
    ) ?? null;

  // ---------------------------------------------------
  // COMPTEUR DES MODIFICATIONS PENDANT LA PAUSE
  // ---------------------------------------------------

  const pendingUpdates = isPaused
    ? files.filter((file) => {
        const frozen = pausedFiles.find(
          (item) => item.path === file.path
        );

        return (
          !frozen ||
          frozen.version !== file.version
        );
      }).length
    : 0;

  // ---------------------------------------------------
  // ACTION : PAUSE / REPRISE
  // ---------------------------------------------------

  function togglePause() {
    if (isPaused) {
      // Reprise du direct.
      // Les fichiers synchronisés redeviennent visibles.

      setPausedFiles(null);
    } else {
      // Création d'un instantané des fichiers.
      // Les modifications suivantes du serveur
      // ne seront pas affichées pendant la pause.

      setPausedFiles(
        files.map((file) => ({ ...file }))
      );
    }
  }

  // ---------------------------------------------------
  // ACTION : COPIER LE LIEN DE SESSION
  // ---------------------------------------------------

  function copySessionLink() {
    void navigator.clipboard.writeText(
      window.location.href
    );
  }

  // =====================================================
  // PAGE D'ACCUEIL SANS SESSION
  // =====================================================

  if (!sessionId) {
    return (
      <main className="welcome-page">
        <div className="welcome-icon">
          {"</>"}
        </div>

        <h1>CodeLive</h1>

        <p>
          Suivez le code de votre formateur
          en temps réel.
        </p>

        <p className="muted">
          Pour rejoindre un cours, ouvrez le lien
          transmis par votre formateur.
        </p>
      </main>
    );
  }

  // =====================================================
  // INTERFACE ÉTUDIANT
  // =====================================================

  return (
    <div className="app-shell">

      {/* ============================================= */}
      {/* BARRE SUPÉRIEURE                              */}
      {/* ============================================= */}

      <header className="topbar">

        <div className="brand">
          <span className="brand-icon">
            {"</>"}
          </span>

          <strong>CodeLive</strong>

          <span className="brand-subtitle">
            Espace étudiant
          </span>
        </div>

        <div className="topbar-actions">

          <span className="session-label">
            Session {sessionId}
          </span>

          <span
            className={`connection-badge status-${status}`}
          >
            <span className="status-dot" />

            {status === "connected"
              ? isPaused
                ? "EN PAUSE"
                : "EN DIRECT"
              : status === "connecting"
                ? "CONNEXION..."
                : status === "stopped"
                  ? "TERMINÉE"
                  : "HORS LIGNE"}
          </span>

        </div>
      </header>

      {/* ============================================= */}
      {/* ESPACE DE TRAVAIL                             */}
      {/* ============================================= */}

      <main className="workspace">

        {/* =========================================== */}
        {/* EXPLORATEUR DE FICHIERS                     */}
        {/* =========================================== */}

        <aside className="sidebar">

          <div className="sidebar-heading">
            EXPLORATEUR
          </div>

          <div className="file-list">

            {visibleFiles.length === 0 ? (

              <p className="empty-files">
                Aucun fichier partagé pour le moment.
              </p>

            ) : (

              [...visibleFiles]
                .sort((a, b) =>
                  a.path.localeCompare(b.path)
                )
                .map((file) => (

                  <button
                    key={file.path}
                    className={
                      "file-item" +
                      (
                        effectiveSelectedPath === file.path
                          ? " active"
                          : ""
                      )
                    }
                    onClick={() =>
                      setSelectedPath(file.path)
                    }
                  >

                    <span className="file-icon">
                      {"{}"}
                    </span>

                    <span className="file-name">
                      {file.path}
                    </span>

                  </button>

                ))

            )}

          </div>

          <div className="sidebar-footer">
            <span>
              {visibleFiles.length} fichier(s)
            </span>
          </div>

        </aside>

        {/* =========================================== */}
        {/* PANNEAU PRINCIPAL                          */}
        {/* =========================================== */}

        <section className="main-panel">

          {/* ----------------------------------------- */}
          {/* AVERTISSEMENT DE DÉCONNEXION              */}
          {/* ----------------------------------------- */}

          {(
            status === "disconnected" ||
            status === "error"
          ) && (

            <div className="notice">
              Connexion interrompue.{" "}

              <button onClick={reconnect}>
                Reconnecter
              </button>
            </div>

          )}

          {/* ----------------------------------------- */}
          {/* SESSION TERMINÉE                          */}
          {/* ----------------------------------------- */}

          {status === "stopped" && (

            <div className="notice">
              La session a été terminée par
              le formateur.
            </div>

          )}

          {/* ----------------------------------------- */}
          {/* ERREUR                                    */}
          {/* ----------------------------------------- */}

          {error && (

            <div className="error-message">
              {error}
            </div>

          )}

          {/* ----------------------------------------- */}
          {/* AFFICHAGE DU CODE                         */}
          {/* ----------------------------------------- */}

          <CodeViewer file={selectedFile} />

          {/* ========================================= */}
          {/* BARRE INFÉRIEURE                          */}
          {/* ========================================= */}

          <footer className="bottom-bar">

            <div className="bottom-status">

              {isPaused ? (

                <span className="paused-indicator">
                  Affichage figé

                  {pendingUpdates > 0 &&
                    ` · ${pendingUpdates} fichier(s) modifié(s)`}
                </span>

              ) : (

                <span>
                  {status === "connected"
                    ? "Synchronisation active"
                    : "Synchronisation inactive"}
                </span>

              )}

            </div>

            <div className="bottom-actions">

              {/* Copier l'adresse de session */}

              <button
                className="secondary-button"
                onClick={copySessionLink}
              >
                Copier le lien
              </button>

              {/* Pause / Reprise */}

              {isPaused ? (

                <button
                  className="live-button"
                  onClick={togglePause}
                >
                  ● Reprendre le direct
                </button>

              ) : (

                <button
                  className="secondary-button"
                  onClick={togglePause}
                  disabled={
                    status !== "connected"
                  }
                >
                  ⏸ Pause
                </button>

              )}

            </div>

          </footer>

        </section>

      </main>

    </div>
  );
}
