/**
 * `tests/ui/vocabulary.test.ts` - unit tier.
 *
 * The student vocabulary module names every main tool and gives it a subtitle, and no student-visible string in the interface sources, the tool descriptors, the tutorial text or the world scripts uses a retired term (design 017 section 6.5).
 * The scan reads the listed source files as text, drops comments, takes the string literals that read as prose, and looks for each retired term as a whole word, ignoring case. Code ids (strings with a "/" and no space, and lowercase words without a space) are not prose. `allowedPhrases` lists the few phrases that contain a retired word legitimately.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { retiredTerms, toolNames } from "../../src/ui/vocabulary";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const mainToolIds = [
  "geodesicEmitters/emitter",
  "geodesicMeasurements/length",
  "geodesicMeasurements/protractor",
  "placedFlags/flag",
  "worldMap/map",
] as const;

/** Source files and folders whose string literals are student-visible, relative to the repository root. Folders list their `.ts` (or `.world.js`) files. */
const scannedFiles = [
  "src/modules/geodesicEmitters/client.ts",
  "src/modules/geodesicMeasurements/client.ts",
  "src/modules/placedFlags/client.ts",
  "src/modules/worldMap/client.ts",
  "src/modules/geodesicModel/tieTool.ts",
  "src/modules/geodesicEmitters/module.ts",
  "src/modules/geodesicModel/module.ts",
  "src/modules/geodesicMeasurements/module.ts",
  "src/modules/placedFlags/module.ts",
  "src/modules/carry/module.ts",
  "src/modules/curveShortening/module.ts",
  "src/runtime/coreTools.ts",
  "src/world-objects/helpHubCopy.ts",
  "src/world-objects/placedFlags.ts",
  "src/world-objects/measureLengthTool.ts",
  "src/world-objects/protractorTool.ts",
  "src/world-objects/library.ts",
  "src/world-objects/runtimeObjectRegistry.ts",
  "src/world-objects/geodesic/segments.ts",
  "src/world-objects/geodesic/intersections.ts",
  "src/world-objects/geodesic/objects.ts",
  "src/authoring/worldBuilder.ts",
  "src/render/three/palette/header.ts",
];
const scannedFolders: readonly { readonly folder: string; readonly suffix: string; readonly except?: readonly string[] }[] = [
  { folder: "src/ui", suffix: ".ts" },
  { folder: "src/render/three/palette/pages", suffix: ".ts", except: ["debugSettings.ts"] },
  { folder: "src/examples", suffix: ".world.js" },
];

/** Phrases that contain a retired word and are fine, each with the reason. Removed from a string before the scan. */
const allowedPhrases: readonly { readonly phrase: string; readonly reason: string }[] = [
  { phrase: "Go home", reason: "the action name Go home (design 017 6.3) contains the retired word Home" },
  { phrase: "length =", reason: "a measurement reads \"<beam> length = <value>\": the ordinary word, not the retired tool name Length" },
  { phrase: "carry on", reason: "ordinary English (walk across an edge and carry on), not the action Carry" },
  { phrase: "Portal quantities", reason: "a switch on the debug settings page, which is not student-visible (job 70 decision 8)" },
  { phrase: "Portal panel", reason: "a switch on the debug settings page, which is not student-visible (job 70 decision 8)" },
];

function listFiles(): string[] {
  const files = [...scannedFiles];
  for (const { folder, suffix, except = [] } of scannedFolders) {
    for (const name of fs.readdirSync(path.join(root, folder))) {
      if (name.endsWith(suffix) && !except.includes(name)) files.push(`${folder}/${name}`);
    }
  }
  return files;
}

/** Whether the literal that starts at `start` is an argument of `Error(` or of a console call: those messages are for authors and developers, not for students. */
function isErrorMessage(source: string, start: number): boolean {
  const statementStart = Math.max(source.lastIndexOf(";", start), source.lastIndexOf("{", start), 0);
  return /Error\(|console\.\w+\(/.test(source.slice(statementStart, start));
}

/** The text of the string literals of a source file, outside comments. Template literals give their text parts, without the `${...}` expressions. */
function extractStringLiterals(source: string): string[] {
  const literals: string[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      const start = index;
      let text = "";
      index += 1;
      while (index < source.length && source[index] !== char && source[index] !== "\n") {
        if (source[index] === "\\") {
          text += source[index + 1] ?? "";
          index += 2;
        } else {
          text += source[index];
          index += 1;
        }
      }
      if (!isErrorMessage(source, start)) literals.push(text);
      index += 1;
    } else if (char === "`") {
      const start = index;
      let text = "";
      index += 1;
      while (index < source.length && source[index] !== "`") {
        if (source[index] === "\\") {
          text += source[index + 1] ?? "";
          index += 2;
        } else if (source[index] === "$" && source[index + 1] === "{") {
          let depth = 1;
          index += 2;
          while (index < source.length && depth > 0) {
            if (source[index] === "{") depth += 1;
            if (source[index] === "}") depth -= 1;
            index += 1;
          }
          text += "\u0001";
        } else {
          text += source[index];
          index += 1;
        }
      }
      if (!isErrorMessage(source, start)) literals.push(text);
      index += 1;
    } else {
      index += 1;
    }
  }
  return literals;
}

/** Whether a literal reads as prose a student could see, not as a code id or an asset path. */
function isProse(literal: string): boolean {
  if (/\s/.test(literal.trim())) {
    return !(literal.includes("/") && !/\s/.test(literal.trim()));
  }
  return /^[A-Z][a-z]+$/.test(literal);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The retired terms that a string uses; terms of a single character are key names and symbols, which are not looked for in prose. */
function retiredTermsIn(literal: string): string[] {
  let text = literal;
  for (const { phrase } of allowedPhrases) text = text.replace(new RegExp(escapeRegExp(phrase), "gi"), " ");
  return retiredTerms
    .filter((term) => term.length > 1)
    .filter((term) => new RegExp(`(?<![\\w])${escapeRegExp(term)}(?![\\w])`, "i").test(text));
}

describe("student vocabulary", () => {
  it("names every main tool and gives it a subtitle", () => {
    for (const id of mainToolIds) {
      expect(toolNames[id].name.length).toBeGreaterThan(0);
      expect(toolNames[id].subtitle.length).toBeGreaterThan(0);
    }
  });

  it("keeps the retired terms out of the student-visible strings", () => {
    const hits: string[] = [];
    for (const file of listFiles()) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      for (const literal of extractStringLiterals(source)) {
        if (!isProse(literal)) continue;
        const used = retiredTermsIn(literal);
        if (used.length > 0) hits.push(`${file}: "${literal.slice(0, 90)}" uses ${used.join(", ")}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("finds a retired term, and lets an allowed phrase and a code id through", () => {
    expect(retiredTermsIn("Place a Geodesic emitter")).toContain("Geodesic emitter");
    expect(retiredTermsIn("Press Go home")).toEqual([]);
    expect(isProse("geodesicEmitters/emitter")).toBe(false);
    expect(isProse("edit-sign")).toBe(false);
    expect(isProse("Remove")).toBe(true);
  });

  it("explains every allowed phrase", () => {
    for (const entry of allowedPhrases) expect(entry.reason.length).toBeGreaterThan(10);
  });
});
