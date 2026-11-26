/**
 * Help palette pages: the Help hub (one row per part of Help), the tutorial's index of cards, and the paged tutorial and goal pages
 * (the card's title, an optional picture, the text, control rows that show the input icon of the current device, and a pager at the bottom).
 * The header names the part of Help and the page number; the page body fills the rest of the panel.
 */
import { Container, Image, Text } from "@pmndrs/uikit";
import { BookOpen, Check, ChevronLeft, ChevronRight, Lightbulb, Sparkles } from "@pmndrs/uikit-lucide";
import type { PagedHelpControl, PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { RuntimeToolId } from "../../../../glue/toolIds";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, activeColor, borderColor, buttonHeight, chipColor, chipTextColor, fontPx, inactiveColor, raisedColor, textColor, typeScale } from "../tokens";
import {
  createBodyText,
  createButtonText,
  createCaption,
  createHeadingText,
  createInteractiveSurface,
  createNavigationRow,
  createPageBody,
  createScrollArea,
  disabledReasonColor,
  withDisabledReason,
} from "../widgets";
import { helpText } from "../../../../world-objects/vocabulary";

/**
 * Help hub page: a line of text and one row per part of Help, dispatching to the tutorial, goal or discoveries callback.
 */
export function buildQuestionHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "question-help" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const page = createPageBody({ gap: 12 });
  page.add(createCaption(content.body, { fontSize: typeScale.body }));
  page.add(new Container({ height: 4, flexShrink: 0 }));

  for (const entry of content.options) {
    const iconProperties = { width: 26, height: 26, color: textColor };
    const row = createNavigationRow({
      itemId: `question-help:${entry.id}`,
      label: entry.label,
      icon: entry.id === "tutorial" ? new BookOpen(iconProperties)
        : entry.id === "goal" ? new Lightbulb(iconProperties)
          : new Sparkles(iconProperties),
      disabled: entry.disabled,
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
    page.add(withDisabledReason(row, entry.disabled ? entry.disabledReason : undefined, "100%"));
  }
  return page;
}

/**
 * Tutorial or goal page: the card's title, the text (with its picture), and a pager (previous, page label, next) pinned to the bottom; disabled arrows are inert.
 * A How to card scrolls as one column with its picture above the text; a Things to try page keeps its picture beside the text. The tutorial's index view lists its cards instead.
 */
export function buildPagedHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "tutorial" | "goal" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  if (content.kind === "tutorial" && content.view === "index") {
    return buildTutorialIndex(content, options);
  }

  const isCard = content.kind === "tutorial";
  const page = createPageBody({ gap: 16 });

  const titleRow = new Container({ width: "100%", flexDirection: "row", alignItems: "center", gap: 14, flexShrink: 0 });
  titleRow.add(createHeadingText(content.title));
  if (content.kind === "tutorial" && content.startHere === true) {
    titleRow.add(createStartHereChip());
  }
  page.add(titleRow);
  // A card of a tool the world cannot support says so at the top.
  if (content.kind === "tutorial" && content.disabledReason !== undefined) {
    const reason = new Text({
      text: content.disabledReason,
      fontSize: fontPx(typeScale.body),
      fontWeight: "bold",
      color: disabledReasonColor,
      fill: disabledReasonColor,
      flexShrink: 0,
      wordBreak: "break-word",
    });
    reason.userData.scenePaletteDisabledReason = content.disabledReason;
    page.add(reason);
  }

  const main = isCard
    ? createScrollArea({ gap: 14 })
    : new Container({
        width: "100%",
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minHeight: 0,
        flexDirection: "row",
        gap: 24,
      });
  if (content.imageSrc) {
    const picture = new Image({
      src: content.imageSrc,
      width: isCard ? "100%" : 400,
      height: isCard ? 180 : 236,
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
    gap: 12,
  });
  text.add(createBodyText(content.body));
  for (const control of content.controls) {
    text.add(createControlRow(control));
  }
  main.add(text);
  page.add(main);

  const footer = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexShrink: 0,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor,
  });

  const previousButton = createInteractiveSurface({
    width: 150,
    height: buttonHeight,
    label: "",
    disabled: content.previousAction.disabled,
    backgroundColor: inactiveColor,
    onClick: () => {
      if (content.kind === "tutorial") {
        options.onTutorialPreviousRequested?.();
      } else {
        options.onGoalPreviousRequested?.();
      }
    },
  });
  previousButton.userData.scenePaletteItemId = `${content.kind}:previous`;
  previousButton.add(new ChevronLeft({ width: 24, height: 24, color: textColor }), createButtonText(content.previousAction.label, typeScale.button));

  const middle = new Container({ flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, justifyContent: "center", minHeight: buttonHeight });
  // "Try it": takes the card's tool, closes Help and shows the first step of the tool's tip.
  const hasTryIt = content.kind === "tutorial" && content.toolId !== undefined && content.tryItAction !== undefined;
  if (content.kind === "tutorial" && content.toolId !== undefined && content.tryItAction !== undefined) {
    const toolId = content.toolId;
    const tryIt = content.tryItAction;
    const tryItButton = createInteractiveSurface({
      width: "auto",
      height: buttonHeight,
      paddingX: 22,
      label: tryIt.label,
      labelFontSize: typeScale.button,
      disabled: tryIt.disabled,
      backgroundColor: activeColor,
      onClick: () => options.onTutorialTryItRequested?.(toolId as RuntimeToolId),
    });
    tryItButton.userData.scenePaletteItemId = "tutorial-try-it";
    middle.add(withDisabledReason(tryItButton, tryIt.disabled ? tryIt.disabledReason : undefined, 240));
  }
  // The page number is in the header, next to the title.

  const nextButton = createInteractiveSurface({
    width: 150,
    height: buttonHeight,
    label: "",
    disabled: content.nextAction.disabled,
    backgroundColor: actionColor,
    onClick: () => {
      if (content.kind === "tutorial") {
        options.onTutorialNextRequested?.();
      } else {
        options.onGoalNextRequested?.();
      }
    },
  });
  nextButton.userData.scenePaletteItemId = `${content.kind}:next`;
  nextButton.add(createButtonText(content.nextAction.label, typeScale.button), new ChevronRight({ width: 24, height: 24, color: textColor }));

  footer.add(
    withDisabledReason(previousButton, content.previousAction.disabled ? content.previousAction.disabledReason : undefined, 150),
    middle,
    withDisabledReason(nextButton, content.nextAction.disabled ? content.nextAction.disabledReason : undefined, 150),
  );
  // A single page has nowhere to go: no pager, unless it has a Try it button.
  const singlePage = content.previousAction.disabled && content.nextAction.disabled;
  if (!singlePage || hasTryIt) {
    page.add(footer);
  }
  return page;
}

// One control row: the input on a light chip (its icon, or its name when it has none) and what it does.
function createControlRow(control: PagedHelpControl): Container {
  const row = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flexShrink: 0,
  });
  const chip = new Container({
    minWidth: 44,
    height: 44,
    paddingX: control.hint.iconSrc ? 4 : 12,
    borderRadius: 10,
    backgroundColor: chipColor,
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
    chip.add(new Text({ text: control.hint.label, fontSize: fontPx(typeScale.caption + 1), fontWeight: "bold", color: chipTextColor, fill: chipTextColor }));
  }
  row.add(chip);
  row.add(new Text({
    text: control.hint.iconSrc ? `${control.hint.label}: ${control.label}` : control.label,
    fontSize: fontPx(typeScale.body - 1),
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
    backgroundColor: chipColor,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    pointerEvents: "none",
  });
  chip.add(new Text({ text: helpText.startHere, fontSize: fontPx(typeScale.caption - 1), fontWeight: "bold", color: chipTextColor, fill: chipTextColor }));
  return chip;
}

// Two index buttons and their gap fill the scroll area's width (the panel's inner width less the scrollbar lane).
const indexButtonWidth = 440;

// The tutorial's index: a line of text and one button per card, two to a row, in a scroll area.
function buildTutorialIndex(
  content: Extract<PaletteDefinition["content"], { readonly kind: "tutorial" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const page = createPageBody({ gap: 14 });
  page.add(createCaption(content.body, { fontSize: typeScale.body }));
  const list = createScrollArea({ gap: 10 });
  const grid = new Container({
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    flexShrink: 0,
  });
  for (const topic of content.topics) {
    const button = createInteractiveSurface({
      width: indexButtonWidth,
      height: 60,
      label: "",
      justifyContent: "flex-start",
      paddingX: 18,
      backgroundColor: raisedColor,
      onClick: () => options.onTutorialPageRequested?.(topic.pageIndex),
    });
    button.userData.scenePaletteItemId = `tutorial-topic:${topic.pageIndex}`;
    button.add(new Text({
      text: topic.title,
      fontSize: fontPx(typeScale.body),
      fontWeight: "bold",
      color: textColor,
      fill: textColor,
      flexGrow: 1,
      flexShrink: 1,
      pointerEvents: "none",
    }));
    if (topic.startHere) button.add(createStartHereChip());
    if (topic.read) {
      // The tick of a card that was opened.
      const tick = new Check({ width: 24, height: 24, color: activeColor, flexShrink: 0 });
      tick.userData.scenePaletteReadTick = true;
      button.add(tick);
    }
    grid.add(topic.disabledReason !== undefined ? withDisabledReason(button, topic.disabledReason, indexButtonWidth) : button);
  }
  list.add(grid);
  page.add(list);
  return page;
}
