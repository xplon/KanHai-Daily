#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_GAME_ID = "2ec21879-b28b-4ea4-89f8-aafb87d6e532";
const DEFAULT_SERVER = "https://uncivserver.xyz";
const DEFAULT_LOCAL_SAVE = "D:/Program/Unciv/SaveFiles/Autosave";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");

const rankingKeys = {
  S: "score",
  N: "population",
  C: "growth",
  P: "production",
  G: "gold",
  T: "territory",
  F: "force",
  H: "happiness",
  W: "technologies",
  A: "culture",
};

const rankingLabels = {
  score: "评分",
  population: "人口",
  growth: "增长",
  production: "产能",
  gold: "金币",
  territory: "领土",
  force: "军力",
  happiness: "快乐",
  technologies: "科技",
  culture: "文化",
};

function parseArgs(argv) {
  const args = {
    source: "remote",
    gameId: DEFAULT_GAME_ID,
    server: DEFAULT_SERVER,
    local: DEFAULT_LOCAL_SAVE,
    out: path.join(PROJECT_DIR, "reports", "latest.md"),
    snapshotDir: path.join(PROJECT_DIR, "data", "snapshots"),
    maxEvents: 24,
    snapshot: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--source") args.source = next();
    else if (arg === "--game-id") args.gameId = next();
    else if (arg === "--server") args.server = next().replace(/\/+$/, "");
    else if (arg === "--local") args.local = next();
    else if (arg === "--out") args.out = next();
    else if (arg === "--snapshot-dir") args.snapshotDir = next();
    else if (arg === "--max-events") args.maxEvents = Number(next());
    else if (arg === "--no-snapshot") args.snapshot = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.maxEvents) || args.maxEvents < 1) {
    throw new Error("--max-events must be a positive number");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node kanghai-daily/scripts/kanghai-daily.mjs [options]

Options:
  --source remote|local      Data source, defaults to remote
  --game-id <uuid>           Unciv multiplayer game id
  --server <url>             Unciv multiplayer server, defaults to https://uncivserver.xyz
  --local <path>             Local save path for --source local
  --out <path>               Markdown report output path
  --snapshot-dir <path>      Snapshot root for diffing future reports
  --max-events <number>      Max recent events in report, defaults to 24
  --no-snapshot              Do not write full GameInfo snapshots`);
}

function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.get(parsed, { timeout: 30000 }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
        res.resume();
        resolve(fetchText(new URL(location, parsed).toString(), redirectCount + 1));
        return;
      }

      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`GET ${url} failed with HTTP ${status}: ${body.slice(0, 200)}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`GET ${url} timed out`));
    });
    req.on("error", reject);
  });
}

function decodeUncivData(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  const jsonText = zlib.gunzipSync(Buffer.from(trimmed, "base64")).toString("utf8");
  return JSON.parse(jsonText);
}

async function loadGame(args) {
  if (args.source === "local") {
    const raw = await fs.readFile(args.local, "utf8");
    return { game: decodeUncivData(raw), sourceLabel: `local:${args.local}` };
  }

  if (args.source !== "remote") {
    throw new Error("--source must be remote or local");
  }

  const raw = await fetchText(`${args.server}/files/${args.gameId}`);
  return { game: decodeUncivData(raw), sourceLabel: `${args.server}/files/${args.gameId}` };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function hashGame(game) {
  return createHash("sha1").update(stableJson(game)).digest("hex");
}

async function readPreviousSnapshot(snapshotDir, gameId, currentHash) {
  const latest = path.join(snapshotDir, gameId, "latest.json");
  try {
    const raw = await fs.readFile(latest, "utf8");
    const previous = JSON.parse(raw);
    if (hashGame(previous) === currentHash) return null;
    return previous;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeSnapshot(snapshotDir, game, currentHash) {
  const gameId = game.gameId || DEFAULT_GAME_ID;
  const dir = path.join(snapshotDir, gameId);
  await fs.mkdir(dir, { recursive: true });

  const latest = path.join(dir, "latest.json");
  let latestHash = "";
  try {
    latestHash = hashGame(JSON.parse(await fs.readFile(latest, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const text = `${JSON.stringify(game, null, 2)}\n`;
  if (latestHash !== currentHash) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `turn-${String(game.turns ?? 0).padStart(3, "0")}-${currentHash.slice(0, 8)}-${stamp}.json`);
    await fs.writeFile(file, text, "utf8");
  }
  await fs.writeFile(latest, text, "utf8");
}

function unwrap(text) {
  return String(text ?? "")
    .replace(/\[\[([^\]]+)]]/g, "$1")
    .replace(/\[([^\]]+)]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function getTiles(game) {
  return game.tileMap?.tileList || [];
}

function getMajorCivs(game) {
  return (game.civilizations || []).filter((civ) => {
    if (civ.civID === "Barbarians" || civ.civID === "Spectator") return false;
    return civ.playerType === "Human" || (civ.cities || []).length >= 2;
  });
}

function getUnitCounts(game) {
  const counts = {};
  for (const tile of getTiles(game)) {
    for (const slot of ["militaryUnit", "civilianUnit"]) {
      const unit = tile[slot];
      if (!unit) continue;
      const owner = unit.owner || "(unknown)";
      counts[owner] ??= { total: 0, military: 0, civilian: 0 };
      counts[owner].total += 1;
      if (slot === "militaryUnit") counts[owner].military += 1;
      else counts[owner].civilian += 1;
    }
  }
  return counts;
}

function cityPopulation(city) {
  return city.population?.population ?? 1;
}

function parseRankingStats(statsHistory) {
  const turns = Object.keys(statsHistory || {})
    .map((turn) => Number(turn))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const latestTurn = turns.at(-1);
  const raw = latestTurn == null ? "" : statsHistory[String(latestTurn)];
  const stats = {};

  if (typeof raw === "string") {
    const regex = /([SNCPGTFHWA])(-?\d+)/g;
    let match;
    while ((match = regex.exec(raw))) {
      stats[rankingKeys[match[1]]] = Number(match[2]);
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      const name = key.length === 1 ? rankingKeys[key] : key;
      if (name) stats[name] = Number(value);
    }
  }

  return { turn: latestTurn, stats };
}

function civMetrics(game) {
  const units = getUnitCounts(game);
  return getMajorCivs(game).map((civ) => {
    const cities = civ.cities || [];
    const techs = civ.tech?.techsResearched || [];
    const policies = civ.policies?.numberOfAdoptedPolicies ?? civ.policies?.adoptedPolicies?.length ?? 0;
    const ranking = parseRankingStats(civ.statsHistory);
    const unitCount = units[civ.civID] || { total: 0, military: 0, civilian: 0 };
    return {
      civ: civ.civID,
      cities: cities.length,
      population: cities.reduce((sum, city) => sum + cityPopulation(city), 0),
      gold: civ.gold ?? 0,
      science: civ.tech?.scienceOfLast8Turns?.at?.(-1) ?? null,
      culture: civ.policies?.cultureOfLast8Turns?.at?.(-1) ?? null,
      techs: techs.length,
      latestTech: techs.at(-1) || "",
      policies,
      units: unitCount.total,
      military: unitCount.military,
      civilian: unitCount.civilian,
      statsTurn: ranking.turn,
      ...ranking.stats,
    };
  });
}

function metricMap(metrics) {
  return new Map(metrics.map((item) => [item.civ, item]));
}

function metricChanges(current, previous) {
  if (!previous) return [];
  const before = metricMap(civMetrics(previous));
  const changes = [];

  for (const item of current) {
    const old = before.get(item.civ);
    if (!old) {
      changes.push(`${item.civ} 新进入统计表`);
      continue;
    }

    const fields = [
      ["cities", "城市"],
      ["population", "人口"],
      ["techs", "科技"],
      ["policies", "政策"],
      ["units", "单位"],
      ["score", "评分"],
      ["force", "军力"],
      ["gold", "金币"],
    ];
    const parts = fields
      .map(([key, label]) => {
        const delta = (item[key] ?? 0) - (old[key] ?? 0);
        if (!delta) return "";
        return `${label}${delta > 0 ? "+" : ""}${delta}`;
      })
      .filter(Boolean);

    if (parts.length) changes.push(`${item.civ}: ${parts.join("，")}`);
  }

  return changes;
}

function activeWars(game) {
  const major = new Set(getMajorCivs(game).map((civ) => civ.civID));
  const pairs = new Set();
  for (const civ of game.civilizations || []) {
    if (!major.has(civ.civID)) continue;
    for (const [other, diplo] of Object.entries(civ.diplomacy || {})) {
      if (!major.has(other) || diplo.diplomaticStatus !== "War") continue;
      pairs.add([civ.civID, other].sort().join(" vs "));
    }
  }
  return [...pairs].sort();
}

function activeTrades(game) {
  const major = new Set(getMajorCivs(game).map((civ) => civ.civID));
  const pairs = [];
  const seen = new Set();
  for (const civ of game.civilizations || []) {
    if (!major.has(civ.civID)) continue;
    for (const [other, diplo] of Object.entries(civ.diplomacy || {})) {
      if (!major.has(other) || !diplo.trades?.length) continue;
      const key = [civ.civID, other].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(`${civ.civID} ⇄ ${other} (${diplo.trades.length})`);
    }
  }
  return pairs.sort();
}

function barbarianSummary(game) {
  const tiles = getTiles(game);
  const units = getUnitCounts(game).Barbarians || { total: 0, military: 0, civilian: 0 };
  const camps = tiles.filter((tile) => tile.improvement === "Barbarian encampment").length;
  return { units: units.total, military: units.military, camps };
}

function notificationScore(event) {
  const text = unwrap(event.text);
  let score = 0;
  if (event.category === "War" || /attacked|captured|spotted|bombard/.test(text)) score += 4;
  if (/has been built in a faraway land|Wonder|Terracotta|Great Library|Pyramids/.test(text)) score += 5;
  if (/Research of .* has completed|entered the .* era|has adopted|policy/i.test(text)) score += 4;
  if (/Great .* has been born|ruins|encampment/.test(text)) score += 3;
  if (/has grown|expanded its borders|demands/.test(text)) score += 1;
  return score;
}

function recentEvents(game, maxEvents) {
  const fromTurn = Math.max(0, (game.turns ?? 0) - 2);
  const events = [];
  const seenGlobalBroadcasts = new Set();
  for (const civ of getMajorCivs(game)) {
    for (const log of civ.notificationsLog || []) {
      if ((log.turn ?? 0) < fromTurn) continue;
      for (const notification of log.notifications || []) {
        const text = notification.text || "";
        if (text.includes("has been built in a faraway land")) {
          const key = `${log.turn}|${text}`;
          if (seenGlobalBroadcasts.has(key)) continue;
          seenGlobalBroadcasts.add(key);
        }
        events.push({
          civ: civ.civID,
          turn: log.turn ?? 0,
          category: notification.category || "General",
          text,
        });
      }
    }
  }

  return events
    .map((event, index) => ({ ...event, score: notificationScore(event), index }))
    .sort((a, b) => b.score - a.score || b.turn - a.turn || a.index - b.index)
    .slice(0, maxEvents);
}

function humanizeEvent(event) {
  const text = unwrap(event.text);
  let match;

  if ((match = /^Research of (.+) has completed!?$/.exec(text))) {
    return `${event.civ} 完成科技：${match[1]}`;
  }
  if ((match = /^(.+) has entered the (.+ era)!?$/.exec(text))) {
    return `${match[1]} 进入 ${match[2]}`;
  }
  if ((match = /^(.+) has been built in a faraway land$/.exec(text))) {
    return `世界广播：远方建成 ${match[1]}`;
  }
  if ((match = /^(.+) has been built in (.+)$/.exec(text))) {
    return `${event.civ} 的 ${match[2]} 建成 ${match[1]}`;
  }
  if ((match = /^(.+) has grown!?$/.exec(text))) {
    return `${event.civ} 的 ${match[1]} 人口增长`;
  }
  if ((match = /^(.+) has expanded its borders!?$/.exec(text))) {
    return `${event.civ} 的 ${match[1]} 扩张边界`;
  }
  if ((match = /^(.+) demands (.+)!?$/.exec(text))) {
    return `${event.civ} 的 ${match[1]} 开始需求 ${match[2]}`;
  }
  if ((match = /^We have captured a barbarian encampment and recovered (.+) gold!?$/.exec(text))) {
    return `${event.civ} 清掉蛮寨，缴获 ${match[1]} 金`;
  }
  if ((match = /^An enemy (.+) has attacked our (.+)$/.exec(text))) {
    return `${event.civ} 战线告急：敌方 ${match[1]} 攻击了 ${match[2]}`;
  }
  if ((match = /^An enemy (.+) was spotted (in|near) our territory$/.exec(text))) {
    return `${event.civ} 边境发现敌方 ${match[1]}（${match[2] === "in" ? "境内" : "附近"}）`;
  }
  if ((match = /^(.+) can be promoted!?$/.exec(text))) {
    return `${event.civ} 的 ${match[1]} 可晋升`;
  }
  if ((match = /^A (.+) has been born in (.+)!?$/.exec(text))) {
    return `${event.civ} 的 ${match[2]} 诞生 ${match[1]}`;
  }
  if ((match = /^We have found survivors in the ruins! Population added to (.+).?$/.exec(text))) {
    return `${event.civ} 探索遗迹，幸存者加入 ${match[1]}`;
  }

  return `${event.civ}: ${text}`;
}

function topBy(metrics, key, limit = 3) {
  return [...metrics]
    .filter((item) => Number.isFinite(item[key]))
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
    .slice(0, limit);
}

function tableRow(cells) {
  return `| ${cells.map((cell) => String(cell ?? "")).join(" | ")} |`;
}

function formatLeaderboard(metrics, key) {
  const leaders = topBy(metrics, key, 3);
  if (!leaders.length) return "";
  return `${rankingLabels[key] || key}: ${leaders.map((item) => `${item.civ} ${item[key]}`).join("，")}`;
}

function formatReport({ game, previous, sourceLabel, args }) {
  const metrics = civMetrics(game).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const changes = metricChanges(metrics, previous);
  const wars = activeWars(game);
  const trades = activeTrades(game);
  const barbarians = barbarianSummary(game);
  const events = recentEvents(game, args.maxEvents);
  const version = game.version?.createdWith?.text || "unknown";
  const mods = game.gameParameters?.mods || [];
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });

  const scoreLeader = topBy(metrics, "score", 1)[0];
  const forceLeader = topBy(metrics, "force", 1)[0];
  const popLeader = topBy(metrics, "population", 1)[0];
  const lines = [];

  lines.push(`# 看海日报 T${game.turns ?? "?"}`);
  lines.push("");
  lines.push(`生成时间：${generatedAt}`);
  lines.push(`版本：${version}`);
  lines.push(`数据源：${sourceLabel}`);
  lines.push("");

  lines.push("## 一句话局势");
  if (scoreLeader) lines.push(`- 总评暂由 ${scoreLeader.civ} 领跑（${scoreLeader.score}），${popLeader?.civ ?? "未知"} 人口最厚，${forceLeader?.civ ?? "未知"} 军力最显眼。`);
  lines.push(`- 蛮族仍然很热闹：地图上约 ${barbarians.military} 支蛮族军事单位，${barbarians.camps} 个蛮寨。`);
  lines.push(wars.length ? `- 主权玩家战争：${wars.join("；")}。` : "- 主权玩家之间暂未发现公开战争，主要新闻来自扩张、科技和蛮族摩擦。");
  lines.push("");

  lines.push("## 排行榜");
  for (const key of ["score", "force", "population", "production", "technologies", "culture"]) {
    const line = formatLeaderboard(metrics, key);
    if (line) lines.push(`- ${line}`);
  }
  lines.push("");

  if (changes.length) {
    lines.push("## 本次快照变化");
    for (const change of changes.slice(0, 12)) lines.push(`- ${change}`);
    lines.push("");
  }

  lines.push("## 文明速览");
  lines.push(tableRow(["文明", "城市", "人口", "科技", "政策", "金币", "科研", "文化", "单位", "军力", "评分"]));
  lines.push(tableRow(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]));
  for (const item of metrics) {
    lines.push(tableRow([
      item.civ,
      item.cities,
      item.population,
      item.techs,
      item.policies,
      item.gold,
      item.science ?? "-",
      item.culture ?? "-",
      item.units,
      item.force ?? "-",
      item.score ?? "-",
    ]));
  }
  lines.push("");

  lines.push("## 今日看点");
  if (events.length) {
    for (const event of events) {
      lines.push(`- T${event.turn} ${humanizeEvent(event)}`);
    }
  } else {
    lines.push("- 暂无可提炼的近回合通知。");
  }
  lines.push("");

  lines.push("## 外交与交易");
  lines.push(wars.length ? `- 战争：${wars.join("；")}` : "- 战争：暂无主权玩家公开战争。");
  lines.push(trades.length ? `- 现有交易：${trades.join("；")}` : "- 现有交易：未从主要文明外交表中提取到活跃交易。");
  lines.push("");

  lines.push("## 元信息");
  lines.push(`- Game ID: ${game.gameId}`);
  lines.push(`- Mods: ${mods.length ? mods.join(", ") : "无"}`);
  lines.push(`- 完整地图 tile 数：${getTiles(game).length}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { game, sourceLabel } = await loadGame(args);
  const currentHash = hashGame(game);
  const previous = args.snapshot ? await readPreviousSnapshot(args.snapshotDir, game.gameId || args.gameId, currentHash) : null;
  if (args.snapshot) await writeSnapshot(args.snapshotDir, game, currentHash);

  const report = formatReport({ game, previous, sourceLabel, args });
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, report, "utf8");
  console.log(`Wrote ${args.out}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
