/**
 * Help palette pages: the question-mark hub, the tutorial's index of pages, and the paged tutorial and goal pages (title, optional picture, body, and control rows that show the input icon of the current device).
 */
import { Container, Image, Text } from "@pmndrs/uikit";
import { Check, ChevronLeft, ChevronRight } from "@pmndrs/uikit-lucide";
import type { PagedHelpControl, PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { RuntimeToolId } from "../../../../glue/toolIds";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, activeColor, borderColor, mutedTextColor, scrollbarBorderColor, scrollbarColor, sectionColor, textColor, fontPx } from "../tokens";
import { createButtonText, createInteractiveSurface, disabledReasonColor, withDisabledReason } from "../widgets";
import { helpText, surfaceNames } from "../../../../world-objects/vocabulary";

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
    fontSize: fontPx(34),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  panel.add(new Text({
    text: content.body,
    fontSize: fontPx(20),
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
        } else if (entry.id === "goal") {
          options.onQuestionHelpGoalRequested?.();
        } else if (entry.id === "discoveries") {
          options.onQuestionHelpDiscoveriesRequested?.();
        }
      },
    });
    button.userData.scenePaletteItemId = `question-help:${entry.id}`;
    optionRows.add(withDisabledReason(button, entry.disabled ? entry.disabledReason : undefined, "100%"));
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
  const isCard = content.kind === "tutorial";
  const panel = new Container({
    width: "100%",
    height: isCard ? 600 : 560,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  const titleRow = new Container({ width: "100%", flexDirection: "row", alignItems: "center", gap: 14, flexShrink: 0 });
  titleRow.add(new Text({
    text: content.title,
    fontSize: fontPx(34),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  if (content.kind === "tutorial" && content.startHere === true) {
    titleRow.add(createStartHereChip());
  }
  panel.add(titleRow);
  // A card of a tool the world cannot support says so at the top.
  if (content.kind === "tutorial" && content.disabledReason !== undefined) {
    const reason = new Text({
      text: content.disabledReason,
      fontSize: fontPx(20),
      fontWeight: "bold",
      color: disabledReasonColor,
      fill: disabledReasonColor,
      flexShrink: 0,
      wordBreak: "break-word",
    });
    reason.userData.scenePaletteDisabledReason = content.disabledReason;
    panel.add(reason);
  }
  // A How to card scrolls as one column with its picture above the text at full panel width; a Things to try page keeps its picture beside the text.
  const main = isCard
    ? new Container({
        width: "100%",
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: "column",
        gap: 12,
        overflow: "scroll",
        paddingRight: 24,
        scrollbarWidth: 14,
        scrollbarColor,
        scrollbarBorderColor,
        scrollbarBorderWidth: 2,
        scrollbarBorderRadius: 7,
        scrollbarZIndex: 1004,
      })
    : new Container({
        width: "100%",
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: "row",
        gap: 20,
      });
  if (content.imageSrc) {
    const picture = new Image({
      src: content.imageSrc,
      width: isCard ? "100%" : 420,
      height: isCard ? 150 : 236,
      keepAspectRatio: false,
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
    ...(isCard ? { width: "100%" as const, flexShrink: 0 } : { flexGrow: 1, flexShrink: 1 }),
    flexDirection: "column",
    gap: 10,
  });
  text.add(new Text({
    text: content.body,
    fontSize: fontPx(content.imageSrc && !isCard ? 19 : 20),
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

  // "Try it": takes the card's tool, closes Help and shows the first step of the tool's tip.
  if (content.kind === "tutorial" && content.toolId !== undefined && content.tryItAction !== undefined) {
    const toolId = content.toolId;
    const tryIt = content.tryItAction;
    const tryItButton = createInteractiveSurface({
      width: 220,
      height: 46,
      label: tryIt.label,
      labelFontSize: 20,
      disabled: tryIt.disabled,
      backgroundColor: tryIt.disabled ? "#334155" : activeColor,
      onClick: () => options.onTutorialTryItRequested?.(toolId as RuntimeToolId),
    });
    tryItButton.userData.scenePaletteItemId = "tutorial-try-it";
    panel.add(withDisabledReason(tryItButton, tryIt.disabled ? tryIt.disabledReason : undefined, 220));
  }

  const controls = new Container({
    width: "100%",
    minHeight: 54,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  });
  const previousButton = createInteractiveSurface({
    width: 140,
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
  }), createButtonText(content.previousAction.label, 18));

  const pageLabel = new Text({
    text: content.pageLabel,
    fontSize: fontPx(18),
    fontWeight: "bold",
    color: mutedTextColor,
    fill: mutedTextColor,
    flexShrink: 0,
  });

  const nextButton = createInteractiveSurface({
    width: 140,
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
  nextButton.add(createButtonText(content.nextAction.label, 18), new ChevronRight({
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  }));

  controls.add(
    withDisabledReason(previousButton, content.previousAction.disabled ? content.previousAction.disabledReason : undefined, 140),
    pageLabel,
    withDisabledReason(nextButton, content.nextAction.disabled ? content.nextAction.disabledReason : undefined, 140),
  );
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
    chip.add(new Text({ text: control.hint.label, fontSize: fontPx(18), fontWeight: "bold", color: "#0f172a", fill: "#0f172a" }));
  }
  row.add(chip);
  row.add(new Text({
    text: control.hint.iconSrc ? `${control.hint.label}: ${control.label}` : control.label,
    fontSize: fontPx(18),
    fontWeight: "medium",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  return row;
}

// The small mark on the card a newcomer should read first.
function createStartHereChip(): Container {
  const chip = new Container({
    paddingX: 10,
    paddingY: 3,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  chip.add(new Text({ text: helpText.startHere, fontSize: fontPx(16), fontWeight: "bold", color: "#0f172a", fill: "#0f172a" }));
  return chip;
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
  panel.add(new Text({ text: content.title, fontSize: fontPx(34), fontWeight: "bold", color: textColor, fill: textColor, flexShrink: 0 }));
  panel.add(new Text({ text: content.body, fontSize: fontPx(20), fontWeight: "medium", color: mutedTextColor, fill: mutedTextColor, flexShrink: 0 }));
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
      label: "",
      justifyContent: "flex-start",
      paddingLeft: 18,
      backgroundColor: topic.startHere ? activeColor : actionColor,
      onClick: () => options.onTutorialPageRequested?.(topic.pageIndex),
    });
    button.userData.scenePaletteItemId = `tutorial-topic:${topic.pageIndex}`;
    button.add(createButtonText(topic.title, 20));
    if (topic.startHere) button.add(createStartHereChip());
    if (topic.read) {
      // The tick of a card that was opened.
      const tick = new Check({ width: 26, height: 26, color: textColor, fill: textColor });
      tick.userData.scenePaletteReadTick = true;
      button.add(tick);
    }
    grid.add(topic.disabledReason !== undefined ? withDisabledReason(button, topic.disabledReason, 436) : button);
  }
  panel.add(grid);
  return panel;
}
