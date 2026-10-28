/**
 * Modal DOM editor for a placed flag (sign): message text, text color, delete, and close.
 * Role: desktop-only UI overlay appended to a container (document.body in the app). It does not own flag data; every edit is reported to the caller through callbacks, and the caller applies it to the runtime object registry and re-renders the flag.
 * While open it listens for Escape in the capture phase on document, swallows the event and closes. The root element is styled by the desktop-flag-editor CSS classes.
 * Lifecycle: the creator must call dispose() to remove the element and any listener left behind.
 */
import { placedFlagFontColors, placedFlagMaxMessageLength, type PlacedFlagObject } from "../../world-objects/placedFlags";

/** Handle to the flag editor created by {@link createDesktopFlagEditor}. */
export interface DesktopFlagEditor {
  /** Root element of the editor; hidden while closed. */
  readonly root: HTMLDivElement;
  /** Shows the editor for the flag: fills the message input, builds the color swatches (marking the flag's current color), focuses and selects the input text. Does nothing about any previously open flag; calling open while already open just retargets the editor. */
  open(flag: PlacedFlagObject): void;
  /** Hides the editor and calls onClosed; a no-op when already closed. */
  close(): void;
  /** True while the editor is visible. */
  isOpen(): boolean;
  /** Removes the Escape listener and the root element without calling onClosed. */
  dispose(): void;
}

/**
 * Creates the (initially hidden) flag editor, appends it to container and returns its handle.
 * Callbacks receive the id of the flag being edited. onMessageChanged fires on every keystroke with the full input value (the input is limited to placedFlagMaxMessageLength characters). onFontColorChanged fires when a swatch is clicked, with a CSS color from placedFlagFontColors. onDeleteRequested fires from the delete button, immediately before the editor closes. onClosed fires once each time the editor goes from open to closed, whether by Done, X, Enter, Escape or delete; the shell's implementation re-requests pointer lock there.
 */
export function createDesktopFlagEditor(
  container: HTMLElement,
  options: {
    readonly onMessageChanged: (flagId: string, message: string) => void;
    readonly onFontColorChanged: (flagId: string, fontColor: string) => void;
    readonly onDeleteRequested: (flagId: string) => void;
    readonly onClosed: () => void;
  },
): DesktopFlagEditor {
  const root = document.createElement("div");
  root.className = "desktop-flag-editor";
  root.hidden = true;

  const form = document.createElement("form");
  form.className = "desktop-flag-editor-panel";

  const frameCloseButton = document.createElement("button");
  frameCloseButton.type = "button";
  frameCloseButton.className = "desktop-flag-editor-close";
  frameCloseButton.textContent = "X";
  frameCloseButton.ariaLabel = "Close flag editor";

  const header = document.createElement("div");
  header.className = "desktop-flag-editor-header";

  const input = document.createElement("input");
  input.className = "desktop-flag-editor-input";
  input.type = "text";
  input.maxLength = placedFlagMaxMessageLength;
  input.ariaLabel = "Flag message";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "desktop-flag-editor-delete";
  deleteButton.textContent = "\u{1f5d1}";
  deleteButton.ariaLabel = "Delete flag";

  const colors = document.createElement("div");
  colors.className = "desktop-flag-editor-colors";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "desktop-tool-palette-button";
  closeButton.textContent = "Done";

  let activeFlagId: string | undefined;

  // Live-edit: every change is pushed to the caller immediately.
  input.addEventListener("input", () => {
    if (activeFlagId) {
      options.onMessageChanged(activeFlagId, input.value);
    }
  });
  closeButton.addEventListener("click", () => {
    editor.close();
  });
  frameCloseButton.addEventListener("click", () => {
    editor.close();
  });
  deleteButton.addEventListener("click", () => {
    if (!activeFlagId) {
      return;
    }

    const flagId = activeFlagId;
    options.onDeleteRequested(flagId);
    editor.close();
  });
  // Enter in the input submits the form; treat it as Done.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    editor.close();
  });

  // Capture-phase handler so Escape closes the editor and is stopped before bubble-phase handlers see it.
  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Escape" || root.hidden) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    editor.close();
  };

  header.append(input, deleteButton);
  form.append(frameCloseButton, header, colors, closeButton);
  root.append(form);
  container.append(root);

  // Declared after the listeners above, which reference it lazily at event time.
  const editor: DesktopFlagEditor = {
    root,
    open(flag) {
      activeFlagId = flag.id;
      input.value = flag.message;
      // Rebuild swatches each time so the selected marker reflects the opened flag.
      colors.replaceChildren(...placedFlagFontColors.map((color) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "desktop-flag-editor-color";
        button.style.backgroundColor = color;
        button.ariaLabel = `Set flag text color ${color}`;
        button.dataset.selected = String(color === flag.fontColor);
        button.addEventListener("click", () => {
          if (activeFlagId) {
            options.onFontColorChanged(activeFlagId, color);
            for (const item of colors.querySelectorAll("button")) {
              item.dataset.selected = String(item === button);
            }
          }
        });
        return button;
      }));
      root.hidden = false;
      document.addEventListener("keydown", handleDocumentKeyDown, true);
      input.focus();
      input.select();
    },
    close() {
      if (root.hidden) {
        return;
      }

      root.hidden = true;
      activeFlagId = undefined;
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      options.onClosed();
    },
    isOpen() {
      return !root.hidden;
    },
    dispose() {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      root.remove();
    },
  };

  return editor;
}
