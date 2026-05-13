#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");

function parseArgs(argv) {
  const args = {
    reportsDir: path.join(PROJECT_DIR, "reports"),
    docsDir: path.join(PROJECT_DIR, "docs"),
    gameSlug: "",
    gameName: "",
    editorName: "",
    includeRuns: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--reports-dir") args.reportsDir = path.resolve(next());
    else if (arg === "--docs-dir") args.docsDir = path.resolve(next());
    else if (arg === "--game-slug") args.gameSlug = slugify(next());
    else if (arg === "--game-name") args.gameName = next();
    else if (arg === "--editor-name") args.editorName = next();
    else if (arg === "--include-run") args.includeRuns.push(next());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/build-pages.mjs [options]

Options:
  --reports-dir <path>  Source reports directory, defaults to ./reports
  --docs-dir <path>     GitHub Pages output directory, defaults to ./docs
  --game-slug <slug>    Public game/session slug; defaults to the first 8 chars of the source game id
  --game-name <name>    Public game/session name; defaults to 对局 <hash>
  --editor-name <name>  Masthead byline/signature; defaults to a situational pen name
  --include-run <name>  Only publish this reports/runs folder; repeat for multiple issues`);
}

function stripInline(text) {
  return String(text ?? "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\*{1,3}|\*{1,3}$/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function extractSourceGameId(sourcePack) {
  const label = sourcePack?.metadata?.sourceLabel || "";
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(label);
  return match?.[1] || sourcePack?.metadata?.gameId || "";
}

function publicGameInfo(sourcePack, args) {
  const sourceGameId = extractSourceGameId(sourcePack);
  const shortId = (sourceGameId || args.gameSlug || "kanhai").replace(/-/g, "").slice(0, 8).toLowerCase();
  const id = args.gameSlug || shortId;
  return {
    id,
    name: args.gameName || `对局 ${shortId}`,
    shortId,
  };
}

function makeEditorName(brief, parsed, args) {
  if (args.editorName) return args.editorName;
  const headline = parsed.headline || parsed.sections?.[0]?.headline || "";
  const articleText = [headline, ...(parsed.sections || []).flatMap((section) => [
    section.kicker,
    section.headline,
    ...(section.blocks || []).map((block) => block.text || (block.items || []).join("")),
  ])].join("\n");
  const profiles = brief?.civProfiles || [];
  const forceful = profiles.find((profile) => (profile.postureTags || []).some((tag) => /声势最盛|武备醒目|军势/.test(tag)));
  const fragile = profiles.find((profile) => (profile.postureTags || []).some((tag) => /低迷|偏窄|病/.test(tag)));
  if (/蛮族|兵影|战|边境|军势|夺城/.test(articleText)) return "边境来信人";
  if (/外交|友好|宣言|互市|商路/.test(articleText)) return "电报房匿名观察员";
  if (/奇观|石阵|信仰|文化|祭司|学问/.test(articleText)) return "旧书页旁的记事员";
  if (fragile?.civ) return "暗潮边的守夜人";
  if (forceful?.civ) return "风向记录员";
  return "潮汐边的匿名主笔";
}

function parseRunName(name) {
  const turn = /^T(\d+)/i.exec(name)?.[1] ?? "";
  const stamp = /(\d{8})-(\d{6})/.exec(name);
  const year = /^T\d+_([^_]+)_/.exec(name)?.[1] ?? "";
  const issueId = `${turn ? `t${turn.padStart(3, "0")}` : "issue"}-${stamp ? `${stamp[1]}-${stamp[2]}` : slugify(name)}`;
  let generatedAt = "";
  let generatedAtLabel = "";
  if (stamp) {
    const [, date, time] = stamp;
    generatedAt = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`;
    generatedAtLabel = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
  }

  return {
    issueId,
    turn: turn ? Number(turn) : null,
    year,
    generatedAt,
    generatedAtLabel,
  };
}

function normalizeMarkdown(markdown) {
  return String(markdown ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function findPaperName(lines, fallback) {
  const first = lines.map((line) => line.trim()).find(Boolean);
  return stripInline(first || fallback || "看海日报");
}

function findDateline(lines, brief, runInfo) {
  for (const raw of lines) {
    const line = stripInline(raw);
    if (/公元|回合|春|夏|秋|冬/.test(line) && !/看海日报/.test(line)) return line;
  }
  if (brief?.dateline?.year) return `${brief.dateline.year}${brief.dateline.currentPlayer ? `·${brief.dateline.currentPlayer}回合` : ""}`;
  return runInfo.year || "";
}

function extractSectionHeading(rawLine) {
  const line = rawLine
    .trim()
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .trim();
  const match = /^【([^】]+)】\s*(.*)$/.exec(line);
  if (!match) return null;
  const explicitHeadline = stripInline(match[2]);
  return {
    section: stripInline(match[1]),
    headline: explicitHeadline || stripInline(match[1]),
    hasExplicitHeadline: Boolean(explicitHeadline),
  };
}

function parseBlocks(lines) {
  const blocks = [];
  let paragraph = [];
  let quote = [];
  let list = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: stripInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({ type: "quote", text: stripInline(quote.join("\n")) });
    quote = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list.map(stripInline).filter(Boolean) });
    list = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^-{3,}$/.test(line)) {
      flushAll();
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    flushList();

    const boldOnly = /^\*\*([^*]+)\*\*[:：]?$/.exec(line);
    if (boldOnly) {
      flushParagraph();
      blocks.push({ type: "subhead", text: stripInline(boldOnly[1]) });
      continue;
    }

    paragraph.push(line);
  }

  flushAll();
  return blocks.filter((block) => block.type !== "paragraph" || block.text);
}

function extractEditorNote(sections) {
  for (const section of sections) {
    const nextBlocks = [];
    let found = null;
    for (const block of section.blocks || []) {
      const text = block.text || "";
      if (!found && block.type === "paragraph" && /^(本报)?编辑部按[：:]/.test(text)) {
        found = {
          title: "本报编辑部按",
          text: text.replace(/^(本报)?编辑部按[：:]\s*/, ""),
        };
        continue;
      }
      nextBlocks.push(block);
    }
    section.blocks = nextBlocks;
    if (found) return found;
  }
  return null;
}

function parsePaper(markdown, brief, runInfo) {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split("\n");
  const sections = [];
  let current = null;
  let prefaceLines = [];
  let afterDivider = true;

  const closeCurrent = () => {
    if (!current) return;
    current.blocks = parseBlocks(current.bodyLines);
    delete current.bodyLines;
    sections.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const isDivider = /^-{3,}$/.test(rawLine.trim());
    if (isDivider) {
      if (current) current.bodyLines.push(rawLine);
      else prefaceLines.push(rawLine);
      afterDivider = true;
      continue;
    }

    const heading = extractSectionHeading(rawLine);
    const isMarkdownHeading = /^\s{0,3}#{1,6}\s+/.test(rawLine);
    const hasHeadlineAfterKicker = heading?.hasExplicitHeadline;
    const isSectionHeading = heading && (isMarkdownHeading || hasHeadlineAfterKicker || !current || afterDivider);
    if (isSectionHeading) {
      closeCurrent();
      current = {
        id: `section-${sections.length + 1}`,
        kicker: heading.section,
        headline: heading.headline,
        bodyLines: [],
      };
      afterDivider = false;
      continue;
    }

    if (current) current.bodyLines.push(rawLine);
    else prefaceLines.push(rawLine);
    if (rawLine.trim()) afterDivider = false;
  }
  closeCurrent();
  const editorNote = extractEditorNote(sections);

  return {
    paperName: findPaperName(lines, brief?.newspaper?.name),
    dateline: findDateline(lines, brief, runInfo),
    preface: parseBlocks(prefaceLines).filter((block) => !/看海日报/.test(block.text ?? "")),
    sections,
    editorNote,
    rawMarkdown: normalized.trim(),
  };
}

function makeIssueSummary(brief) {
  const civProfiles = (brief?.civProfiles || []).map((profile) => ({
    civ: profile.civ,
    tags: profile.postureTags || [],
    scoreBand: profile.scoreBand || "",
    forceBand: profile.forceBand || "",
  }));
  const events = (brief?.publicEvents || []).slice(0, 8).map((event) => ({
    year: event.year,
    civ: event.civ,
    kind: event.kind,
    text: event.text,
  }));
  const preferredColumns = brief?.newspaper?.preferredColumns || [];

  return {
    preferredColumns,
    civProfiles,
    events,
  };
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function collectRuns(reportsDir) {
  const runsDir = path.join(reportsDir, "runs");
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsDir, entry.name);
    const paperPath = path.join(dir, "paper.md");
    if (!(await fileExists(paperPath))) continue;
    const stat = await fs.stat(paperPath);
    runs.push({
      name: entry.name,
      dir,
      paperPath,
      briefPath: path.join(dir, "brief.json"),
      sourcePackPath: path.join(dir, "source-pack.json"),
      factCheckPath: path.join(dir, "fact-check.md"),
      mtimeMs: stat.mtimeMs,
    });
  }
  return runs.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

async function buildIssue(run, args) {
  const runInfo = parseRunName(run.name);
  const [paper, brief, sourcePack] = await Promise.all([
    fs.readFile(run.paperPath, "utf8"),
    readJsonIfPresent(run.briefPath),
    readJsonIfPresent(run.sourcePackPath),
  ]);
  const parsed = parsePaper(paper, brief, runInfo);
  const headline = parsed.sections[0]?.headline || parsed.paperName;
  const game = publicGameInfo(sourcePack, args);
  const byline = makeEditorName(brief, { ...parsed, headline }, args);

  return {
    schema: "kanhai-page-issue/v1",
    id: runInfo.issueId,
    gameId: game.id,
    gameName: game.name,
    gameShortId: game.shortId,
    runLabel: run.name,
    turn: runInfo.turn,
    year: brief?.dateline?.year || runInfo.year,
    generatedAt: runInfo.generatedAt,
    generatedAtLabel: runInfo.generatedAtLabel,
    paperName: parsed.paperName,
    dateline: parsed.dateline,
    headline,
    byline,
    summary: makeIssueSummary(brief),
    preface: parsed.preface,
    sections: parsed.sections,
    editorNote: parsed.editorNote,
    rawMarkdown: parsed.rawMarkdown,
  };
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function cleanGeneratedIssues(docsDir) {
  const dir = path.join(docsDir, "data", "issues");
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => fs.unlink(path.join(dir, entry.name))));
}

function hasIssueBody(issue) {
  return (issue.sections || []).some((section) => section.blocks?.length);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = await collectRuns(args.reportsDir);
  if (!runs.length) throw new Error(`No paper.md files found under ${path.join(args.reportsDir, "runs")}`);
  const selectedRuns = selectRuns(runs, args.includeRuns);

  const issues = [];
  const skipped = [];
  await cleanGeneratedIssues(args.docsDir);
  for (const run of selectedRuns) {
    const issue = await buildIssue(run, args);
    if (!hasIssueBody(issue)) {
      skipped.push(run.name);
      continue;
    }
    issues.push(issue);
    await writeJson(path.join(args.docsDir, "data", "issues", `${issue.id}.json`), issue);
  }
  if (!issues.length) throw new Error("No issues with article sections were found.");

  const games = [...issues.reduce((map, issue) => {
    const group = map.get(issue.gameId) || {
      id: issue.gameId,
      name: issue.gameName,
      shortId: issue.gameShortId,
      latestIssueId: issue.id,
      issues: [],
    };
    group.issues.push(issue);
    group.latestIssueId = issue.id;
    map.set(issue.gameId, group);
    return map;
  }, new Map()).values()].map((game) => ({
    ...game,
    issues: [...game.issues]
      .reverse()
      .map((issue) => ({
        id: issue.id,
        title: issue.headline,
        paperName: issue.paperName,
        dateline: issue.dateline,
        year: issue.year,
        turn: issue.turn,
        generatedAt: issue.generatedAt,
        generatedAtLabel: issue.generatedAtLabel,
      })),
  }));
  const latest = issues.at(-1);
  const manifest = {
    schema: "kanhai-pages/v1",
    updatedAt: new Date().toISOString(),
    latest: {
      gameId: latest.gameId,
      issueId: latest.id,
    },
    games,
  };
  await writeJson(path.join(args.docsDir, "data", "manifest.json"), manifest);

  console.log(`Built ${issues.length} issue(s) into ${args.docsDir}`);
  if (skipped.length) console.log(`Skipped ${skipped.length} empty issue(s): ${skipped.join(", ")}`);
  console.log(`Latest issue: ${latest.id}`);
}

function selectRuns(runs, includeRuns) {
  if (!includeRuns.length) return runs;
  const wanted = new Set(includeRuns);
  const selected = runs.filter((run) => wanted.has(run.name));
  const found = new Set(selected.map((run) => run.name));
  const missing = includeRuns.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Included run folder(s) not found: ${missing.join(", ")}`);
  return selected;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
