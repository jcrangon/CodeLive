import { useEffect, useState } from "react";
import type { ConnectionStatus, ServerMessage, SharedFile } from "../protocol";

type CodeLiveState = {
  files: SharedFile[];
  status: ConnectionStatus;
  error: string | null;
};

const initialState: CodeLiveState = {
  files: [],
  status: "disconnected",
  error: null,
};

function useCodeLiveConnection(sessionId: string | null) {
  const [state, setState] = useState<CodeLiveState>(() => ({
    ...initialState,
    status: sessionId ? "connecting" : "disconnected",
  }));

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let active = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/${encodeURIComponent(sessionId)}`,
    );

    socket.onopen = () => {
      if (!active) return;

      setState((previous) => ({
        ...previous,
        status: "connected",
        error: null,
      }));
    };

    socket.onmessage = (event: MessageEvent) => {
      if (!active) return;

      let message: ServerMessage;

      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        setState((previous) => ({
          ...previous,
          error: "Message JSON invalide reçu",
        }));
        return;
      }

      switch (message.type) {
        case "session:connected":
          break;

        case "session:snapshot":
          if (!Array.isArray(message.files)) break;

          setState((previous) => ({
            ...previous,
            files: message.files,
          }));
          break;

        case "file:updated": {
          const file = message.file;

          if (
            !file ||
            typeof file.path !== "string" ||
            typeof file.content !== "string" ||
            typeof file.version !== "number"
          ) {
            break;
          }

          setState((previous) => {
            const index = previous.files.findIndex(
              (item) => item.path === file.path,
            );

            if (index === -1) {
              return {
                ...previous,
                files: [...previous.files, file],
              };
            }

            if (previous.files[index].version >= file.version) {
              return previous;
            }

            const next = [...previous.files];
            next[index] = file;

            return {
              ...previous,
              files: next,
            };
          });

          break;
        }

        case "session:stopped":
          setState((previous) => ({
            ...previous,
            status: "stopped",
          }));

          socket.close(1000, "Session terminée");
          break;

        case "error":
          setState((previous) => ({
            ...previous,
            error: message.message,
          }));
          break;
      }
    };

    socket.onerror = () => {
      if (!active) return;

      setState((previous) => ({
        ...previous,
        error: "Erreur de connexion WebSocket",
      }));
    };

    socket.onclose = () => {
      if (!active) return;

      setState((previous) => ({
        ...previous,
        status: previous.status === "stopped" ? "stopped" : "disconnected",
      }));
    };

    return () => {
      active = false;
      socket.close();
    };
  }, [sessionId, attempt]);

  function reconnect() {
    setState({
      files: [],
      status: sessionId ? "connecting" : "disconnected",
      error: null,
    });

    setAttempt((value) => value + 1);
  }

  return {
    ...state,
    reconnect,
  };
}

// Composant ou hook parent : utiliser une key pour
// réinitialiser l'état lors d'un changement de session.
export function useCodeLive(sessionId: string | null) {
  return useCodeLiveConnection(sessionId);
}
