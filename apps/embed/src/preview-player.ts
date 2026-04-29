/**
 * One shared `<audio>` element per host page, used by every PreviewButton
 * on the page. Starting a new preview stops the previous one so two
 * widgets can't play over each other.
 *
 * Design notes:
 *   - Preact hooks are per-component; state coordination needs a shared
 *     subscriber pattern. Callers (PreviewButton instances) register
 *     themselves with `subscribe(cb)` and render based on whether their
 *     songId equals the currently-playing one.
 *   - Audio element lives on `document.body` rather than inside a shadow
 *     root so it persists across component unmounts (e.g., a widget
 *     re-rendering while preview audio keeps playing).
 */

export type PreviewPlayerState =
  | { kind: "idle" }
  | { kind: "loading"; appleMusicSongId: string }
  | { kind: "playing"; appleMusicSongId: string }
  | { kind: "error"; appleMusicSongId: string; message: string };

type Listener = (state: PreviewPlayerState) => void;

let sharedAudio: HTMLAudioElement | null = null;
let currentState: PreviewPlayerState = { kind: "idle" };
const listeners = new Set<Listener>();

function setState(next: PreviewPlayerState): void {
  currentState = next;
  for (const listener of listeners) listener(next);
}

function ensureAudio(): HTMLAudioElement {
  if (sharedAudio !== null) return sharedAudio;
  const el = document.createElement("audio");
  el.preload = "none";
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
  el.addEventListener("ended", () => setState({ kind: "idle" }));
  el.addEventListener("error", () => {
    setState({
      kind: "error",
      appleMusicSongId: currentState.kind === "idle" ? "" : (currentState.appleMusicSongId ?? ""),
      message: "audio failed to play",
    });
  });
  document.body.appendChild(el);
  sharedAudio = el;
  return el;
}

export function getPreviewPlayerState(): PreviewPlayerState {
  return currentState;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

export async function play(appleMusicSongId: string, url: string): Promise<void> {
  const audio = ensureAudio();
  // Stopping first guarantees a clean state transition if another preview
  // was already playing — browsers otherwise queue a 'pause' event mid-load.
  audio.pause();
  audio.src = url;
  setState({ kind: "loading", appleMusicSongId });
  try {
    await audio.play();
    setState({ kind: "playing", appleMusicSongId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "play failed";
    setState({ kind: "error", appleMusicSongId, message });
  }
}

/**
 * Surface a resolution / non-playback error in the player state machine so
 * subscribed PreviewButtons can render their error treatment (title hint +
 * aria-live announcement). Callers own the message wording.
 */
export function setResolveError(appleMusicSongId: string, message: string): void {
  setState({ kind: "error", appleMusicSongId, message });
}

export function stop(): void {
  if (sharedAudio !== null) {
    sharedAudio.pause();
    // Reset currentTime so the next play starts fresh rather than resuming.
    sharedAudio.currentTime = 0;
  }
  setState({ kind: "idle" });
}
