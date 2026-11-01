/**
 * Help palette pages: the question-mark hub and the paged tutorial and goal pages.
 */
import { Container, Text } from "@pmndrs/uikit";
import { ChevronLeft, ChevronRight } from "@pmndrs/uikit-lucide";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, borderColor, mutedTextColor, sectionColor, textColor } from "../tokens";
import { createInteractiveSurface } from "../widgets";

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
    text: "Help hub",
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
 */
export function buildPagedHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "tutorial" | "goal" }>,
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
  panel.add(new Text({
    text: content.title,
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  panel.add(new Text({
    text: content.body,
    fontSize: 22,
    fontWeight: "medium",
    lineHeight: "140%",
    color: textColor,
    fill: textColor,
    flexGrow: 1,
    flexShrink: 1,
    wordBreak: "break-word",
  }));

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
