/**
 * Help palette pages: the question-mark hub, the tutorial's index of pages, and the paged tutorial and goal pages (title, optional picture, body, and control rows that show the input icon of the current device).
 */
import { Container, Image, Text } from "@pmndrs/uikit";
import { ChevronLeft, ChevronRight } from "@pmndrs/uikit-lucide";
import type { PagedHelpControl, PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, borderColor, mutedTextColor, sectionColor, textColor } from "../tokens";
import { createInteractiveSurface } from "../widgets";
import { surfaceNames } from "../../../../world-objects/vocabulary";

/**
 * Help hub page: title, body text and one button per option, dispatching to the tutorial or goal callback.
 */
export function buildQuestionHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "question-help" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 300,
    flexDirection: "column",
    gap: 16,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(new Text({
    text: surfaceNames.help,
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  panel.add(new Text({
    text: content.body,
    fontSize: 20,
    fontWeight: "medium",
    lineHeight: "140%",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));

  const optionRows = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 10,
  });
  for (const entry of content.options) {
    const button = createInteractiveSurface({
      width: "100%",
      height: 58,
      label: entry.label,
      labelFontSize: 20,
      disabled: entry.disabled,
      backgroundColor: entry.disabled ? "#334155" : actionColor,
      onClick: () => {
        if (entry.id === "tutorial") {
          options.onQuestionHelpTutorialRequested?.();
        } else {
          options.onQuestionHelpGoalRequested?.();
        }
      },
    });
    button.userData.scenePaletteItemId = `question-help:${entry.id}`;
    optionRows.add(button);
  }

  panel.add(optionRows);
  return panel;
}

/**
 * Tutorial or goal page: title, body, and previous / page label / next controls; disabled arrows are inert.
 * A page with a picture shows it to the left of the text; control rows follow the body. The tutorial's index view lists its pages as buttons instead.
 */
export function buildPagedHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "tutorial" | "goal" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  if (content.kind === "tutorial" && content.view === "index") {
    return buildTutorialIndex(content, options);
  }

  // A fixed height keeps the paging arrows in the same place on every page.
  const panel = new Container({
    width: "100%",
    height: 560,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(new Text({
    text: content.title,
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  const main = new Container({
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    gap: 20,
  });
  if (content.imageSrc) {
    const picture = new Image({
      src: content.imageSrc,
      width: 420,
      height: 236,
      flexShrink: 0,
      objectFit: "cover",
      borderRadius: 14,
      depthTest: false,
      depthWrite: false,
      renderOrder: 1002,
    });
    picture.userData.scenePaletteIconSrc = content.imageSrc;
    main.add(picture);
  }
  const text = new Container({
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "column",
    gap: 10,
  });
  text.add(new Text({
    text: content.body,
    fontSize: content.imageSrc ? 19 : 22,
    fontWeight: "medium",
    lineHeight: "140%",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  for (const control of content.controls) {
    text.add(createControlRow(control));
  }
  main.add(text);
  panel.add(main);

  const controls = new Container({
    width: "100%",
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  });
  const previousButton = createInteractiveSurface({
    width: 72,
    height: 46,
    label: "",
    disabled: content.previousAction.disabled,
    backgroundColor: content.previousAction.disabled ? "#334155" : actionColor,
    onClick: () => {
      if (content.kind === "tutorial") {
        options.onTutorialPreviousRequested?.();
      } else {
        options.onGoalPreviousRequested?.();
      }
    },
  });
  previousButton.userData.scenePaletteItemId = `${content.kind}:previous`;
  previousButton.add(new ChevronLeft({
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  }));

  const pageLabel = new Text({
    text: content.pageLabel,
    fontSize: 18,
    fontWeight: "bold",
    color: mutedTextColor,
    fill: mutedTextColor,
    flexShrink: 0,
  });

  const nextButton = createInteractiveSurface({
    width: 72,
    height: 46,
    label: "",
    disabled: content.nextAction.disabled,
    backgroundColor: content.nextAction.disabled ? "#334155" : actionColor,
    onClick: () => {
      if (content.kind === "tutorial") {
        options.onTutorialNextRequested?.();
      } else {
        options.onGoalNextRequested?.();
      }
    },
  });
  nextButton.userData.scenePaletteItemId = `${content.kind}:next`;
  nextButton.add(new ChevronRight({
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  }));

  controls.add(previousButton, pageLabel, nextButton);
  panel.add(controls);
  return panel;
}

// One control row: the input on a light chip (its icon, or its name when it has none) and what it does.
function createControlRow(control: PagedHelpControl): Container {
  const row = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  });
  const chip = new Container({
    minWidth: 44,
    height: 44,
    paddingX: control.hint.iconSrc ? 4 : 10,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  if (control.hint.iconSrc) {
    const icon = new Image({
      src: control.hint.iconSrc,
      width: 36,
      height: 36,
      objectFit: "fill",
      keepAspectRatio: true,
      depthTest: false,
      depthWrite: false,
      renderOrder: 1003,
    });
    icon.userData.scenePaletteIconSrc = control.hint.iconSrc;
    chip.add(icon);
  } else {
    chip.add(new Text({ text: control.hint.label, fontSize: 18, fontWeight: "bold", color: "#0f172a", fill: "#0f172a" }));
  }
  row.add(chip);
  row.add(new Text({
    text: control.hint.iconSrc ? `${control.hint.label}: ${control.label}` : control.label,
    fontSize: 18,
    fontWeight: "medium",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  return row;
}

// The tutorial's index: its title, a line of text and one button per page, two to a row.
function buildTutorialIndex(
  content: Extract<PaletteDefinition["content"], { readonly kind: "tutorial" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 382,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(new Text({ text: content.title, fontSize: 34, fontWeight: "bold", color: textColor, fill: textColor, flexShrink: 0 }));
  panel.add(new Text({ text: content.body, fontSize: 20, fontWeight: "medium", color: mutedTextColor, fill: mutedTextColor, flexShrink: 0 }));
  const grid = new Container({
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  });
  for (const topic of content.topics) {
    const button = createInteractiveSurface({
      width: 436,
      height: 58,
      label: topic.title,
      labelFontSize: 20,
      justifyContent: "flex-start",
      paddingLeft: 18,
      backgroundColor: actionColor,
      onClick: () => options.onTutorialPageRequested?.(topic.pageIndex),
    });
    button.userData.scenePaletteItemId = `tutorial-topic:${topic.pageIndex}`;
    grid.add(button);
  }
  panel.add(grid);
  return panel;
}
