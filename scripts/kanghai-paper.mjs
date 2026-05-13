#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const DEFAULT_GAME_ID = "2ec21879-b28b-4ea4-89f8-aafb87d6e532";
const DEFAULT_SERVER = "https://uncivserver.xyz";
const DEFAULT_LOCAL_SAVE = "D:/Program/Unciv/SaveFiles/Autosave";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const WORKSPACE_DIR = path.resolve(PROJECT_DIR, "..");

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

const civNameMap = {
  "The Maya": "玛雅",
  Rome: "罗马",
  France: "法兰西",
  Mongolia: "蒙古",
  Celts: "凯尔特",
  Carthage: "迦太基",
  Ethiopia: "埃塞俄比亚",
  Barbarians: "蛮族",
  "Vatican City": "梵蒂冈城",
  Antwerp: "安特卫普",
  Valletta: "瓦莱塔",
  "An unknown civilization": "未知文明",
};

const buildingNameMap = {
  "Terracotta Army": "兵马俑",
  "The Great Library": "大图书馆",
  "The Pyramids": "金字塔",
  "Great Wall": "长城",
  "Hanging Gardens": "空中花园",
  Stonehenge: "巨石阵",
  Petra: "佩特拉",
  Colosseum: "斗兽场",
  Library: "图书馆",
  Monument: "纪念碑",
  Park: "公园",
  "Statue of Zeus": "宙斯像",
};

const eraNameMap = {
  Ancient: "远古时代",
  Classical: "古典时代",
  Medieval: "中古时代",
  Renaissance: "文艺复兴时代",
  Industrial: "工业时代",
  Modern: "现代",
  Atomic: "原子能时代",
  Information: "信息时代",
};

const COLUMN_DECK = [
  {
    id: "front_page",
    name: "头版社论",
    role: "用庄严报纸口吻概括大势，适合每期主稿。",
    secrecy: "public",
  },
  {
    id: "field_dispatch",
    name: "战地通讯",
    role: "写边境摩擦、蛮族、战争气氛，但不刊登路线、坐标、兵力细节。",
    secrecy: "public",
  },
  {
    id: "exclusive_wire",
    name: "独家密电",
    role: "政治、经济、文化、军事专家联名分析一点内幕，只能略微涉密，用趋势和隐喻代替精确情报。",
    secrecy: "limited_sensitive",
  },
  {
    id: "politics",
    name: "政治观察",
    role: "分析霸权、联盟、外交口风、宫廷气氛。",
    secrecy: "public",
  },
  {
    id: "economy",
    name: "经济风向",
    role: "写繁荣、困窘、通商、财政传闻，不给精确金币和产出。",
    secrecy: "limited_sensitive",
  },
  {
    id: "culture",
    name: "文化副刊",
    role: "写奇观、宗教、文学、诗歌、悼文和历史典故。",
    secrecy: "public",
  },
  {
    id: "technology",
    name: "科学与奇观",
    role: "写时代变化、奇观广播、技术崇拜或军备焦虑。",
    secrecy: "public",
  },
  {
    id: "obituary",
    name: "讣告与悼文",
    role: "仅在失城、首都陷落、亡国边缘或强烈衰亡叙事时，用半真半假的庄重悼词整活。",
    secrecy: "public",
  },
  {
    id: "classical_archive",
    name: "史馆档案",
    role: "可写文言、檄文、罪己诏、诏书、祭文。",
    secrecy: "public",
  },
  {
    id: "irrelevant_corner",
    name: "市井版",
    role: "完全无关但好玩的报纸角落，例如天气、广告、读者来信、占星台、招聘启事。",
    secrecy: "public",
  },
];

function parseArgs(argv) {
  const args = {
    source: "remote",
    gameId: DEFAULT_GAME_ID,
    server: DEFAULT_SERVER,
    local: DEFAULT_LOCAL_SAVE,
    out: null,
    briefOut: null,
    promptOut: null,
    sourcePackOut: null,
    evidenceOut: null,
    factCheckOut: null,
    rawOut: null,
    factRawOut: null,
    timelineOut: path.join(PROJECT_DIR, "reports", "timeline.md"),
    timelineJsonOut: path.join(PROJECT_DIR, "reports", "timeline.json"),
    style: "auto",
    maxTokens: Number(process.env.KANGHAI_MAX_TOKENS || 1800),
    temperature: Number(process.env.KANGHAI_TEMPERATURE || 0.9),
    noLlm: false,
    noFactCheck: false,
    noTimeline: false,
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
    else if (arg === "--brief-out") args.briefOut = next();
    else if (arg === "--prompt-out") args.promptOut = next();
    else if (arg === "--source-pack-out") args.sourcePackOut = next();
    else if (arg === "--evidence-out") args.evidenceOut = next();
    else if (arg === "--fact-check-out") args.factCheckOut = next();
    else if (arg === "--raw-out") args.rawOut = next();
    else if (arg === "--fact-raw-out") args.factRawOut = next();
    else if (arg === "--timeline-out") args.timelineOut = next();
    else if (arg === "--timeline-json-out") args.timelineJsonOut = next();
    else if (arg === "--style") args.style = next();
    else if (arg === "--max-tokens") args.maxTokens = Number(next());
    else if (arg === "--temperature") args.temperature = Number(next());
    else if (arg === "--no-llm") args.noLlm = true;
    else if (arg === "--no-fact-check") args.noFactCheck = true;
    else if (arg === "--no-timeline") args.noTimeline = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.maxTokens) || args.maxTokens < 200) {
    throw new Error("--max-tokens must be at least 200");
  }
  if (!Number.isFinite(args.temperature) || args.temperature < 0 || args.temperature > 2) {
    throw new Error("--temperature must be between 0 and 2");
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node kanghai-daily/scripts/kanghai-paper.mjs [options]

Options:
  --source remote|local      Data source, defaults to remote
  --game-id <uuid>           Unciv multiplayer game id
  --server <url>             Unciv multiplayer server
  --local <path>             Local save path for --source local
  --out <path>               LLM newspaper output path
  --brief-out <path>         Sanitized brief output path
  --prompt-out <path>        Final LLM prompt output path
  --source-pack-out <path>   Exact JSON source pack visible to the LLM
  --evidence-out <path>      Internal source traceability report path
  --fact-check-out <path>    LLM fact-check report output path
  --raw-out <path>           Raw response metadata output path
  --fact-raw-out <path>      Fact-check response metadata output path
  --timeline-out <path>      Cumulative markdown timeline path
  --timeline-json-out <path> Cumulative JSON timeline path
  --style auto|社论|悼文|文言|诗歌|独家消息
  --no-llm                   Only write source files, do not call API
  --no-fact-check            Skip LLM fact-check after paper generation
  --no-timeline              Do not update cumulative timeline`);
}

async function loadDotenvIfPresent(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=").trim();
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function loadEnvironment() {
  await loadDotenvIfPresent(path.join(WORKSPACE_DIR, ".env"));
  await loadDotenvIfPresent(path.join(PROJECT_DIR, ".env"));
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
    req.on("timeout", () => req.destroy(new Error(`GET ${url} timed out`)));
    req.on("error", reject);
  });
}

function postJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const body = JSON.stringify(payload);
    const req = client.request(
      parsed,
      {
        method: "POST",
        timeout: 120000,
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          let parsedData;
          try {
            parsedData = JSON.parse(data);
          } catch {
            parsedData = { raw: data };
          }
          if (status < 200 || status >= 300) {
            reject(new Error(`POST ${url} failed with HTTP ${status}: ${data.slice(0, 500)}`));
            return;
          }
          resolve(parsedData);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`POST ${url} timed out`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

function byName(collection, name) {
  if (!collection) return null;
  if (Array.isArray(collection)) return collection.find((item) => item?.name === name) || null;
  return collection[name] || null;
}

function decodeUncivData(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  return JSON.parse(zlib.gunzipSync(Buffer.from(trimmed, "base64")).toString("utf8"));
}

async function loadGame(args) {
  if (args.source === "local") {
    return decodeUncivData(await fs.readFile(args.local, "utf8"));
  }
  if (args.source !== "remote") throw new Error("--source must be remote or local");
  return decodeUncivData(await fetchText(`${args.server}/files/${args.gameId}`));
}

function displayCiv(civ) {
  return civNameMap[civ] || civ;
}

function displayBuilding(building) {
  return buildingNameMap[building] || building;
}

function displayEra(era) {
  return eraNameMap[era] || era;
}

function unwrap(text) {
  return String(text ?? "")
    .replace(/\[\[([^\]]+)]]/g, "$1")
    .replace(/\[([^\]]+)]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function baseRulesetName(game) {
  return game.gameParameters?.baseRuleset || "Civ V - Gods & Kings";
}

function speedName(game) {
  return game.gameParameters?.speed || "Quick";
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

function cityPopulation(city) {
  return city.population?.population ?? 1;
}

function parseStatsBlob(raw) {
  const stats = {};
  if (typeof raw === "string") {
    const regex = /([SNCPGTFHWA])(-?\d+)/g;
    let match;
    while ((match = regex.exec(raw))) stats[rankingKeys[match[1]]] = Number(match[2]);
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      const name = key.length === 1 ? rankingKeys[key] : key;
      if (name) stats[name] = Number(value);
    }
  }
  return stats;
}

function statsTurnKeys(statsHistory) {
  return Object.keys(statsHistory || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function parseStatsAt(statsHistory, turn = null) {
  const turns = Object.keys(statsHistory || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!turns.length) return {};
  const selected = turn == null ? turns.at(-1) : turns.filter((item) => item <= turn).at(-1);
  if (selected == null) return {};
  return parseStatsBlob(statsHistory[String(selected)]);
}

function parseRankingStats(statsHistory) {
  return parseStatsAt(statsHistory);
}

function statDelta(civ, key, currentTurn, window = 8) {
  const current = parseStatsAt(civ.statsHistory, currentTurn);
  const previous = parseStatsAt(civ.statsHistory, currentTurn - window);
  if (!Number.isFinite(current[key]) || !Number.isFinite(previous[key])) return null;
  return current[key] - previous[key];
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

function civMetrics(game) {
  const units = getUnitCounts(game);
  return getMajorCivs(game).map((civ) => {
    const cities = civ.cities || [];
    const stats = parseRankingStats(civ.statsHistory);
    const unitCount = units[civ.civID] || { total: 0, military: 0, civilian: 0 };
    const techs = civ.tech?.techsResearched || [];
    const policies = civ.policies?.adoptedPolicies || [];
    return {
      civ: civ.civID,
      displayName: displayCiv(civ.civID),
      cities: cities.length,
      population: cities.reduce((sum, city) => sum + cityPopulation(city), 0),
      policies: civ.policies?.numberOfAdoptedPolicies ?? policies.length,
      techs: techs.length,
      unitTotal: unitCount.total,
      military: unitCount.military,
      ...stats,
    };
  });
}

function rank(metrics, key) {
  return [...metrics]
    .filter((item) => Number.isFinite(item[key]))
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
}

function tierByRank(item, ranked, labels) {
  const index = ranked.findIndex((entry) => entry.civ === item.civ);
  if (index < 0) return labels[1];
  const pct = ranked.length <= 1 ? 0 : index / (ranked.length - 1);
  if (pct <= 0.25) return labels[2];
  if (pct <= 0.65) return labels[1];
  return labels[0];
}

function civProfiles(metrics) {
  const scoreRank = rank(metrics, "score");
  const forceRank = rank(metrics, "force");
  const popRank = rank(metrics, "population");
  const cityRank = rank(metrics, "cities");

  return metrics.map((item) => {
    const tags = [];
    if (scoreRank.at(0)?.civ === item.civ) tags.push("声势最盛");
    if (scoreRank.at(-1)?.civ === item.civ) tags.push("国势低迷");
    if (forceRank.at(0)?.civ === item.civ) tags.push("武备醒目");
    if (cityRank.at(-1)?.civ === item.civ) tags.push("版图偏窄");
    if (cityRank.at(0)?.civ === item.civ) tags.push("城镇繁多");
    if ((item.force ?? 0) > (item.score ?? 0) * 2) tags.push("军事存在感高于综合国力");

    return {
      civ: item.displayName,
      postureTags: tags.length ? tags : ["局势中游"],
      scoreBand: tierByRank(item, scoreRank, ["低位", "中游", "高位"]),
      forceBand: tierByRank(item, forceRank, ["军势低调", "军势尚可", "军势强劲"]),
      populationBand: tierByRank(item, popRank, ["人口偏少", "人口中等", "人口稠密"]),
      citiesBand: tierByRank(item, cityRank, ["城镇稀少", "城镇适中", "城镇众多"]),
    };
  });
}

function activeWarRecords(game) {
  const major = new Set(getMajorCivs(game).map((civ) => civ.civID));
  const wars = new Map();
  for (const civ of game.civilizations || []) {
    if (!major.has(civ.civID)) continue;
    for (const [other, diplo] of Object.entries(civ.diplomacy || {})) {
      if (!major.has(other) || diplo.diplomaticStatus !== "War") continue;
      const [rawA, rawB] = [civ.civID, other].sort();
      const key = `${rawA}|${rawB}`;
      wars.set(key, {
        civA: displayCiv(rawA),
        civB: displayCiv(rawB),
        rawCivA: rawA,
        rawCivB: rawB,
        status: "War",
        text: [displayCiv(rawA), displayCiv(rawB)].join(" vs "),
      });
    }
  }
  return [...wars.values()].sort((a, b) => a.text.localeCompare(b.text, "zh-Hans-CN"));
}

function activeWars(game) {
  return activeWarRecords(game).map((war) => war.text);
}

function activeTradeRecords(game) {
  const major = new Set(getMajorCivs(game).map((civ) => civ.civID));
  const trades = [];
  const seen = new Set();
  for (const civ of game.civilizations || []) {
    if (!major.has(civ.civID)) continue;
    for (const [other, diplo] of Object.entries(civ.diplomacy || {})) {
      if (!major.has(other) || !diplo.trades?.length) continue;
      const key = [civ.civID, other].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
      const [rawA, rawB] = [civ.civID, other].sort();
      trades.push({
        civA: displayCiv(rawA),
        civB: displayCiv(rawB),
        rawCivA: rawA,
        rawCivB: rawB,
        tradeCount: diplo.trades.length,
        text: `${displayCiv(rawA)}与${displayCiv(rawB)}存在互市传闻`,
      });
    }
  }
  return trades.sort((a, b) => a.text.localeCompare(b.text, "zh-Hans-CN")).slice(0, 5);
}

function activeTrades(game) {
  return activeTradeRecords(game).map((trade) => trade.text);
}

function cityCaptureRecords(game) {
  const major = new Set(getMajorCivs(game).map((civ) => civ.civID));
  const records = [];
  for (const civ of getMajorCivs(game)) {
    for (const city of civ.cities || []) {
      if (!city.foundingCiv || city.foundingCiv === civ.civID) continue;
      records.push({
        turn: city.turnAcquired ?? null,
        city: city.name,
        currentOwner: displayCiv(civ.civID),
        originalOwner: displayCiv(city.foundingCiv),
        rawCurrentOwner: civ.civID,
        rawOriginalOwner: city.foundingCiv,
        isMajorOriginalOwner: major.has(city.foundingCiv),
        populationBand: cityPopulation(city) >= 7 ? "大城" : cityPopulation(city) >= 4 ? "中等城市" : "小城",
        text: `${displayCiv(civ.civID)}夺取了${displayCiv(city.foundingCiv)}旧城${city.name}`,
      });
    }
  }
  return records.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function compareBand(leftName, rightName, leftValue, rightValue, noun) {
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue) || (leftValue <= 0 && rightValue <= 0)) {
    return `${noun}对比资料不足`;
  }
  if (rightValue <= 0 && leftValue > 0) return `${leftName}在${noun}上形成压倒性优势`;
  if (leftValue <= 0 && rightValue > 0) return `${rightName}在${noun}上形成压倒性优势`;
  const ratio = leftValue / rightValue;
  if (ratio >= 3) return `${leftName}在${noun}上形成压倒性优势`;
  if (ratio >= 1.8) return `${leftName}在${noun}上明显占优`;
  if (ratio >= 1.25) return `${leftName}在${noun}上略占上风`;
  if (ratio <= 1 / 3) return `${rightName}在${noun}上形成压倒性优势`;
  if (ratio <= 1 / 1.8) return `${rightName}在${noun}上明显占优`;
  if (ratio <= 1 / 1.25) return `${rightName}在${noun}上略占上风`;
  return `双方${noun}大致相当`;
}

function terrainLabelFromCounts(counts) {
  const rough = (counts.Hill || 0) + (counts.Forest || 0) + (counts.Jungle || 0) + (counts.Marsh || 0);
  const water = (counts.Coast || 0) + (counts.Ocean || 0);
  const open = (counts.Plains || 0) + (counts.Grassland || 0) + (counts.Desert || 0) + (counts.Tundra || 0);
  if (water >= rough && water >= open && water > 0) return "沿海和水域因素明显，战线容易被海上骚扰牵动";
  if (rough >= open && rough > 0) return "丘陵、林地或复杂地形较多，推进节奏可能偏慢";
  if (open > 0) return "开阔地形较多，机动部队更容易发挥影响";
  return "地形特征不明显";
}

function tilesNear(position, tiles, radius = 2) {
  const center = tilePosition(position);
  return tiles.filter((tile) => hexDistance(tilePosition(tile.position), center) <= radius);
}

function frontTerrainSummary(game, rawA, rawB) {
  const tiles = getTiles(game);
  const relevant = [];
  const majorCities = new Map(getMajorCivs(game).map((civ) => [civ.civID, (civ.cities || []).map((city) => tilePosition(city.location))]));
  for (const tile of tiles) {
    const unit = tile.militaryUnit;
    if (!unit || (unit.owner !== rawA && unit.owner !== rawB)) continue;
    const owner = unit.owner;
    const other = owner === rawA ? rawB : rawA;
    const nearOther = (majorCities.get(other) || []).some((city) => hexDistance(tilePosition(tile.position), city) <= 6);
    if (nearOther) relevant.push(...tilesNear(tile.position, tiles, 1));
  }
  const counts = {};
  for (const tile of relevant) {
    counts[tile.baseTerrain] = (counts[tile.baseTerrain] || 0) + 1;
    for (const feature of tile.terrainFeatures || []) counts[feature] = (counts[feature] || 0) + 1;
  }
  return terrainLabelFromCounts(counts);
}

function frontUnitCounts(game, rawA, rawB) {
  const majorCities = new Map(getMajorCivs(game).map((civ) => [civ.civID, (civ.cities || []).map((city) => tilePosition(city.location))]));
  let aNearB = 0;
  let bNearA = 0;
  for (const unit of militaryUnitsOnMap(game)) {
    if (unit.owner === rawA && (majorCities.get(rawB) || []).some((city) => hexDistance(unit.position, city) <= 6)) aNearB += 1;
    if (unit.owner === rawB && (majorCities.get(rawA) || []).some((city) => hexDistance(unit.position, city) <= 6)) bNearA += 1;
  }
  return { aNearB, bNearA };
}

function buildConflictTheaters(game, metrics, captures) {
  const metricByRaw = new Map(metrics.map((item) => [item.civ, item]));
  const candidates = new Map();
  const ensure = (rawA, rawB, reason, weight = 1) => {
    if (!rawA || !rawB || rawA === rawB) return null;
    const key = pairKey(rawA, rawB);
    const [left, right] = key.split("|");
    const existing =
      candidates.get(key) ||
      {
        key,
        rawA: left,
        rawB: right,
        civA: displayCiv(left),
        civB: displayCiv(right),
        reasons: [],
        score: 0,
      };
    existing.reasons.push(reason);
    existing.score += weight;
    candidates.set(key, existing);
    return existing;
  };

  for (const capture of captures) {
    if (capture.isMajorOriginalOwner) ensure(capture.rawCurrentOwner, capture.rawOriginalOwner, "近期或历史夺城线索", 6);
  }

  for (const signal of mapPressureSignals(game)) {
    for (const otherName of [...signal.pressureFrom, ...signal.pressureToward]) {
      const otherMetric = metrics.find((item) => item.displayName === otherName);
      const selfMetric = metrics.find((item) => item.displayName === signal.civ);
      if (selfMetric && otherMetric) ensure(selfMetric.civ, otherMetric.civ, "边境兵影线索", 2);
    }
  }

  const theaters = [];
  for (const candidate of candidates.values()) {
    const metricA = metricByRaw.get(candidate.rawA) || {};
    const metricB = metricByRaw.get(candidate.rawB) || {};
    const relatedCaptures = captures.filter(
      (capture) =>
        pairKey(capture.rawCurrentOwner, capture.rawOriginalOwner) === candidate.key,
    );
    const front = frontUnitCounts(game, candidate.rawA, candidate.rawB);
    const frontBalance = compareBand(candidate.civA, candidate.civB, front.aNearB, front.bNearA, "前线兵影");
    const militaryBalance = compareBand(candidate.civA, candidate.civB, metricA.force, metricB.force, "总体军势");
    const productionBalance = compareBand(candidate.civA, candidate.civB, metricA.production, metricB.production, "产能");
    const scienceBalance = compareBand(candidate.civA, candidate.civB, metricA.technologies, metricB.technologies, "科研积累");
    const terrain = frontTerrainSummary(game, candidate.rawA, candidate.rawB);
    const lines = [
      relatedCaptures.length
        ? `${candidate.civA}与${candidate.civB}之间存在夺城旧账：${relatedCaptures
            .map((capture) => `${capture.currentOwner}夺取${capture.originalOwner}旧城${capture.city}`)
            .join("；")}。`
        : "",
      `双方对比：${militaryBalance}，${productionBalance}。`,
      `前线态势：${frontBalance}。`,
      `相关战区地形判断：${terrain}。`,
    ].filter(Boolean);
    theaters.push({
      id: `WAR-${candidate.civA}-${candidate.civB}`,
      civs: [candidate.civA, candidate.civB],
      status: relatedCaptures.length ? "夺城旧账明确" : "边境兵影紧张",
      reasons: [...new Set(candidate.reasons)],
      capturedCities: relatedCaptures.map((capture) => ({
        year: capture.year,
        city: capture.city,
        from: capture.originalOwner,
        to: capture.currentOwner,
        cityWeight: capture.populationBand,
      })),
      balance: {
        military: militaryBalance,
        production: productionBalance,
        science: scienceBalance,
        front: frontBalance,
        terrain,
      },
      publicSignals: lines,
      score: candidate.score + relatedCaptures.length * 3,
    });
  }

  return theaters
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ score, ...theater }) => theater);
}

function sanitizeEventText(text) {
  let match;
  if ((match = /^(.+) has been built in a faraway land$/.exec(text))) {
    return `远方建成${displayBuilding(match[1])}`;
  }
  if ((match = /^(.+) has entered the (.+) era!?$/.exec(text))) {
    return `${displayCiv(match[1])}进入${displayEra(match[2])}`;
  }
  if ((match = /^(.+) has enhanced (.+?)!?$/.exec(text))) {
    return `${displayCiv(match[1])}强化了${displayBuilding(match[2])}`;
  }
  if ((match = /^Research of (.+) has completed!?$/.exec(text))) {
    return "完成一项新学问";
  }
  if ((match = /^(.+) has been built in (.+)$/.exec(text))) {
    return "某地传来市政工程落成消息";
  }
  if (/can be promoted!?$/.test(text)) return "军中传来晋升消息";
  if (/\b\d+\b enemy units were spotted/.test(text)) return "边境传来多支敌军活动报告";
  if (/was spotted/.test(text)) return "边境传来敌军活动报告";
  if (/has attacked/.test(text)) return "前线发生交火";
  if (/can bombard/.test(text)) return "城防部门声称火力已经就绪";
  if (/encampment/.test(text)) return "有蛮族据点被清剿";
  if (/has grown!?$/.test(text)) return "城市人口增长";
  if (/expanded its borders!?$/.test(text)) return "城市边界扩张";
  return text
    .replace(/\(-?\d+ HP\)/g, "")
    .replace(/\b\d+\b enemy units/g, "多支敌军")
    .replace(/\b\d+\b gold/g, "若干黄金")
    .replace(/\[[^\]]+]/g, "");
}

function publicEventRecords(game) {
  const seen = new Set();
  const globalEvents = [];
  const colorEvents = [];
  for (const civ of getMajorCivs(game)) {
    for (const log of civ.notificationsLog || []) {
      if ((game.turns ?? 0) - (log.turn ?? 0) > 8) continue;
      for (const notification of log.notifications || []) {
        const text = unwrap(notification.text);
        const isWorld = /has been built in a faraway land|has entered the .* era|has enhanced .*|World Congress/i.test(text);
        const isVagueWar = notification.category === "War" && /spotted|attacked|bombard|encampment/.test(text);
        const isCulture = /has been built in|Research of/.test(text);
        if (!isWorld && !isVagueWar && !isCulture) continue;

        const sanitized = sanitizeEventText(text);
        const key = isWorld ? sanitized : `${log.turn}|${civ.civID}|${notification.category}|${sanitized}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const event = {
          turn: log.turn,
          sourceCiv: displayCiv(civ.civID),
          rawSourceCiv: civ.civID,
          civ: isWorld ? "世界广播" : displayCiv(civ.civID),
          kind: isWorld ? "全球广播" : notification.category || "地方消息",
          originalText: text,
          sanitizedText: sanitized,
          sourceScope: isWorld ? "world" : "local_notification",
        };
        if (isWorld) globalEvents.push(event);
        else colorEvents.push(event);
      }
    }
  }
  globalEvents.sort((a, b) => b.turn - a.turn);
  colorEvents.sort((a, b) => b.turn - a.turn);
  return [...globalEvents.slice(0, 7), ...colorEvents.slice(0, 14)];
}

function publicEvents(game) {
  return publicEventRecords(game).map((event) => ({
    year: null,
    turn: event.turn,
    civ: event.civ,
    kind: event.kind,
    text: event.sanitizedText,
  }));
}

function tilePosition(position) {
  return { x: position?.x ?? 0, y: position?.y ?? 0 };
}

function hexDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx + dy));
}

function bandByCount(value, labels = ["无明显迹象", "零星", "活跃", "密集"]) {
  if (value <= 0) return labels[0];
  if (value <= 2) return labels[1];
  if (value <= 6) return labels[2];
  return labels[3];
}

function bandByDelta(delta, labels = ["回落", "平稳", "上升", "跃升"], strong = 120, mild = 35) {
  if (delta == null) return "资料不足";
  if (delta <= -mild) return labels[0];
  if (delta >= strong) return labels[3];
  if (delta >= mild) return labels[2];
  return labels[1];
}

function bandBySmallDelta(delta, labels = ["放缓", "平稳", "推进", "明显推进"], strong = 3, mild = 1) {
  if (delta == null) return "资料不足";
  if (delta < 0) return labels[0];
  if (delta >= strong) return labels[3];
  if (delta >= mild) return labels[2];
  return labels[1];
}

function militaryUnitsOnMap(game) {
  const units = [];
  for (const tile of getTiles(game)) {
    const unit = tile.militaryUnit;
    if (!unit?.owner) continue;
    units.push({
      owner: unit.owner,
      ownerName: displayCiv(unit.owner),
      unitName: unit.name || "未知单位",
      position: tilePosition(tile.position),
    });
  }
  return units;
}

function mapPressureSignals(game) {
  const majorCivs = getMajorCivs(game);
  const major = new Set(majorCivs.map((civ) => civ.civID));
  const units = militaryUnitsOnMap(game);
  const cityPositions = new Map(
    majorCivs.map((civ) => [civ.civID, (civ.cities || []).map((city) => tilePosition(city.location))]),
  );
  const radius = 6;

  return majorCivs.map((civ) => {
    const cities = cityPositions.get(civ.civID) || [];
    let foreignNear = 0;
    let barbarianNear = 0;
    let ownNearForeign = 0;
    const foreignOwners = new Set();
    const pressureTargets = new Set();

    for (const unit of units) {
      const nearOwnCity = cities.some((city) => hexDistance(unit.position, city) <= radius);
      if (nearOwnCity && unit.owner !== civ.civID) {
        if (unit.owner === "Barbarians") barbarianNear += 1;
        else if (major.has(unit.owner)) {
          foreignNear += 1;
          foreignOwners.add(displayCiv(unit.owner));
        }
      }

      if (unit.owner === civ.civID) {
        for (const other of majorCivs) {
          if (other.civID === civ.civID) continue;
          const nearOther = (cityPositions.get(other.civID) || []).some((city) => hexDistance(unit.position, city) <= radius);
          if (nearOther) {
            ownNearForeign += 1;
            pressureTargets.add(displayCiv(other.civID));
            break;
          }
        }
      }
    }

    const foreignBand = bandByCount(foreignNear);
    const barbarianBand = bandByCount(barbarianNear, ["无明显迹象", "零星滋扰", "频繁滋扰", "压力沉重"]);
    const projectionBand = bandByCount(ownNearForeign, ["无明显外向兵影", "边境投影零星", "外向兵影活跃", "外向兵影密集"]);
    const lines = [];
    if (foreignNear > 0) {
      lines.push(`${displayCiv(civ.civID)}周边出现${foreignBand}他国兵影。`);
    }
    if (barbarianNear > 0) {
      lines.push(`${displayCiv(civ.civID)}周边蛮族压力呈${barbarianBand}态势。`);
    }
    if (ownNearForeign > 0) {
      lines.push(`${displayCiv(civ.civID)}对外军事投射呈${projectionBand}。`);
    }

    return {
      id: `MAP-${displayCiv(civ.civID)}`,
      civ: displayCiv(civ.civID),
      pressureFrom: [...foreignOwners].sort(),
      pressureToward: [...pressureTargets].sort(),
      foreignMilitaryPressure: foreignBand,
      barbarianPressure: barbarianBand,
      outwardProjection: projectionBand,
      publicSignals: lines,
      evidenceBand: {
        foreignNear: foreignBand,
        barbarianNear: barbarianBand,
        ownNearForeign: projectionBand,
      },
    };
  });
}

function productionResearchCultureSignals(game) {
  const currentTurn = game.turns ?? 0;
  const majorCivs = getMajorCivs(game);
  return majorCivs.map((civ) => {
    const forceDelta = statDelta(civ, "force", currentTurn);
    const productionDelta = statDelta(civ, "production", currentTurn);
    const techDelta = statDelta(civ, "technologies", currentTurn);
    const cultureDelta = statDelta(civ, "culture", currentTurn);
    const goldDelta = statDelta(civ, "gold", currentTurn);
    const militaryTrend = bandByDelta(forceDelta, ["军势回落", "军势平稳", "军势增厚", "军势跃升"]);
    const productionTrend = bandByDelta(productionDelta, ["产能回落", "产能平稳", "产能上扬", "产能大涨"], 40, 12);
    const scienceTrend = bandBySmallDelta(techDelta, ["科研放缓", "科研平稳", "科研推进", "科研明显推进"], 3, 1);
    const cultureTrend = bandBySmallDelta(cultureDelta, ["文化放缓", "文化平稳", "文化推进", "文化明显推进"], 2, 1);
    const treasuryTrend = bandByDelta(goldDelta, ["财政承压", "财政平稳", "财政转暖", "财政大幅转暖"], 80, 25);

    const publicSignals = [
      militaryTrend.includes("跃升") || militaryTrend.includes("增厚")
        ? `${displayCiv(civ.civID)}近期军备扩张迹象值得关注。`
        : "",
      scienceTrend.includes("明显") || scienceTrend.includes("推进")
        ? `${displayCiv(civ.civID)}学术官僚系统仍在推进新学问。`
        : "",
      cultureTrend.includes("推进") ? `${displayCiv(civ.civID)}文化声量有抬头迹象。` : "",
      productionTrend.includes("大涨") || productionTrend.includes("上扬")
        ? `${displayCiv(civ.civID)}工坊与市政系统近期较为忙碌。`
        : "",
      treasuryTrend.includes("承压") ? `${displayCiv(civ.civID)}财政口径出现承压迹象。` : "",
    ].filter(Boolean);

    return {
      id: `TREND-${displayCiv(civ.civID)}`,
      civ: displayCiv(civ.civID),
      window: "最近约八个回合",
      militaryTrend,
      productionTrend,
      scienceTrend,
      cultureTrend,
      treasuryTrend,
      publicSignals,
      evidenceDeltas: {
        force: forceDelta,
        production: productionDelta,
        technologies: techDelta,
        culture: cultureDelta,
        gold: goldDelta,
      },
    };
  });
}

function wonderCultureScienceSignals(events) {
  const wonderSignals = [];
  const scienceSignals = [];
  const cultureSignals = [];
  for (const event of events) {
    if (/远方建成|进入|强化/.test(event.text)) {
      wonderSignals.push(`${event.year || "年代不明"}：${event.text}`);
    }
    if (/新学问/.test(event.text) || /进入/.test(event.text)) {
      scienceSignals.push(`${event.year || "年代不明"}：${event.civ}传出${event.text}`);
    }
    if (/边界扩张|人口增长|市政工程|强化/.test(event.text)) {
      cultureSignals.push(`${event.year || "年代不明"}：${event.civ}传出${event.text}`);
    }
  }
  return {
    wonderAndReligion: [...new Set(wonderSignals)].slice(0, 8),
    scienceAndEra: [...new Set(scienceSignals)].slice(0, 8),
    cultureAndCityLife: [...new Set(cultureSignals)].slice(0, 8),
  };
}

function buildSourceClaims(brief, mapSignals, trendSignals, broadcastSignals, conflictTheaters = []) {
  const claims = [];
  let index = 1;
  const add = (category, text, basis, sourceIds = []) => {
    if (!text) return;
    claims.push({
      id: `SRC-${String(index).padStart(3, "0")}`,
      category,
      claim: text,
      basis,
      sourceIds,
      publicUse: "只能写成趋势、传闻、社论口吻或文学化表达，不要写成战术建议。",
    });
    index += 1;
  };

  for (const profile of brief.civProfiles || []) {
    const isNotable =
      profile.postureTags.some((tag) => tag !== "局势中游") ||
      profile.scoreBand !== "中游" ||
      profile.forceBand === "军势强劲" ||
      profile.populationBand === "人口稠密" ||
      profile.citiesBand === "城镇众多";
    if (!isNotable) continue;
    add(
      "文明态势",
      `${profile.civ}被整理为：${profile.postureTags.join("、")}；${[
        profile.scoreBand,
        profile.forceBand,
        profile.populationBand,
        profile.citiesBand,
      ].join("、")}。`,
      "文明统计指标的分层结果",
      [`CIV-${profile.civ}`],
    );
  }
  for (const signal of mapSignals) {
    for (const text of signal.publicSignals || []) {
      if (!/密集|压力沉重|活跃|频繁|沉重/.test(text)) continue;
      add("地图趋势", text, "地图上城市附近军事单位的脱敏距离带判断", [signal.id]);
    }
  }
  for (const signal of trendSignals) {
    for (const text of signal.publicSignals || []) {
      if (text.includes("学术官僚系统仍在推进新学问") && signal.scienceTrend !== "科研明显推进") continue;
      add("近期趋势", text, "最近若干回合统计变化的脱敏分层", [signal.id]);
    }
  }
  for (const theater of conflictTheaters.slice(0, 3)) {
    for (const text of theater.publicSignals || []) {
      add("战区态势", text, "夺城记录、地图兵影、双方统计指标和战区地形的脱敏综合判断", [theater.id]);
    }
  }
  for (const [category, lines] of Object.entries(broadcastSignals || {})) {
    for (const line of lines) {
      add(category, line, "近期通知日志整理", ["EVT"]);
    }
  }
  return claims;
}

async function readRulesetJson(baseRuleset, fileName) {
  const candidates = [
    path.join(WORKSPACE_DIR, "Unciv", "android", "assets", "jsons", baseRuleset, fileName),
    path.join("D:", "Program", "Unciv", "jsons", baseRuleset, fileName),
  ];

  for (const file of candidates) {
    try {
      return JSON.parse(stripJsonComments(await fs.readFile(file, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

function speedYearFromRows(turn, speed) {
  let year = speed.startYear ?? -4000;
  let intervalStartTurn = 0;
  const rows = speed.turns || [];
  const lastEnd = rows.at(-1)?.untilTurn ?? turn;
  for (const row of rows) {
    const yearsPerTurn = row.yearsPerTurn;
    const untilTurn = row.untilTurn;
    if (intervalStartTurn >= turn) break;
    if (turn <= untilTurn || untilTurn === lastEnd) {
      year += (turn - intervalStartTurn) * yearsPerTurn;
      break;
    }
    year += (untilTurn - intervalStartTurn) * yearsPerTurn;
    intervalStartTurn = untilTurn;
  }
  return year;
}

async function gameYear(game) {
  const baseRuleset = baseRulesetName(game);
  const gameSpeedName = speedName(game);
  const speeds = await readRulesetJson(baseRuleset, "Speeds.json");
  const eras = await readRulesetJson(baseRuleset, "Eras.json");
  const speed = byName(speeds, gameSpeedName);
  if (!speed) return { year: null, label: `第${game.turns}回合`, speedName: gameSpeedName };

  let turn = game.turns ?? 0;
  const startingEra = game.gameParameters?.startingEra || "Ancient era";
  const startPercent = byName(eras, startingEra)?.startPercent ?? 0;
  if (startPercent && speed.turns?.length) {
    turn += Math.floor((speed.turns.at(-1).untilTurn * startPercent) / 100);
  }

  const year = Math.trunc(speedYearFromRows(turn, speed));
  return { year, label: formatYear(year), speedName: gameSpeedName };
}

function formatYear(year) {
  if (year == null) return "年代不明";
  if (year < 0) return `公元前${Math.abs(year)}年`;
  if (year === 0) return "公元元年";
  return `公元${year}年`;
}

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safePathPart(text) {
  return String(text)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function resolveOutputPaths(args, game, brief) {
  const runSlug = [
    `T${String(game.turns ?? 0).padStart(3, "0")}`,
    safePathPart(brief.dateline.year),
    localTimestamp(),
  ].join("_");
  const runDir = path.join(PROJECT_DIR, "reports", "runs", runSlug);
  args.runDir = runDir;
  args.out ??= path.join(runDir, "paper.md");
  args.briefOut ??= path.join(runDir, "brief.json");
  args.promptOut ??= path.join(runDir, "ai-prompt.md");
  args.sourcePackOut ??= path.join(runDir, "source-pack.json");
  args.evidenceOut ??= path.join(runDir, "evidence.md");
  args.factCheckOut ??= path.join(runDir, "fact-check.md");
  args.rawOut ??= path.join(runDir, "llm-response.json");
  args.factRawOut ??= path.join(runDir, "fact-check-response.json");
  return args;
}

function buildExpertPanels(metrics, wars, trades, conflictTheaters = []) {
  const scoreLeader = rank(metrics, "score").at(0);
  const forceLeader = rank(metrics, "force").at(0);
  const weakest = rank(metrics, "score").at(-1);
  const cityLeader = rank(metrics, "cities").at(0);
  const cultureLeader = rank(metrics, "culture").at(0);

  return {
    politicalAnalyst: [
      scoreLeader ? `${scoreLeader.displayName}的国际声望处在高位，可被包装为“元老院信心指数充足”。` : "",
      weakest ? `${weakest.displayName}的国势偏弱，适合悼文、病危通知或“史馆预案”。` : "",
      conflictTheaters.length
        ? `主要战区线索：${conflictTheaters.map((theater) => `${theater.civs.join("—")}（${theater.status}）`).join("；")}。`
        : wars.length
          ? `公开战争线索：${wars.join("；")}。`
          : "主权国家之间暂未出现适合公开报道的全面战争。",
    ].filter(Boolean),
    economicAnalyst: [
      cityLeader ? `${cityLeader.displayName}城镇网络较广，可写成商路、驿站、粮仓与税吏的故事。` : "",
      trades.length ? `贸易传闻：${trades.join("；")}。` : "贸易消息不显著，可用“市场照常开门，财政官照常皱眉”的语气处理。",
    ].filter(Boolean),
    culturalAnalyst: [
      cultureLeader ? `${cultureLeader.displayName}文化声量较高，可适合作为副刊素材。` : "",
      "世界广播、宗教与奇观消息可写成文明自信或祭司宣传。",
    ],
    militaryAnalyst: [
      forceLeader ? `${forceLeader.displayName}军势最醒目，但禁止写具体部队、部署、路线。` : "",
      conflictTheaters[0] ? `本期最值得战地通讯解释的是${conflictTheaters[0].civs.join("—")}战区，但只能写力量对比、夺城旧账和地形趋势。` : "",
      "蛮族活动频繁，可写成“国际社会头号在野党”，不要写数量和位置。",
    ].filter(Boolean),
  };
}

async function buildBrief(game) {
  const year = await gameYear(game);
  const metrics = civMetrics(game);
  const profiles = civProfiles(metrics);
  const scoreLeader = rank(metrics, "score").at(0);
  const forceLeader = rank(metrics, "force").at(0);
  const weakest = rank(metrics, "score").at(-1);
  const wars = activeWars(game);
  const trades = activeTrades(game);
  const captures = cityCaptureRecords(game);
  for (const capture of captures) {
    if (capture.turn != null) {
      capture.year = (await gameYear({ ...game, turns: capture.turn })).label;
    }
  }
  const conflictTheaters = buildConflictTheaters(game, metrics, captures);
  const events = publicEvents(game);
  for (const event of events) {
    if (event.turn != null) {
      const pseudoGame = { ...game, turns: event.turn };
      event.year = (await gameYear(pseudoGame)).label;
      delete event.turn;
    }
  }
  const mapSignals = mapPressureSignals(game);
  const trendSignals = productionResearchCultureSignals(game);
  const broadcastSignals = wonderCultureScienceSignals(events);

  const preferredColumns = [];
  preferredColumns.push("头版社论");
  if (
    weakest &&
    captures.some((capture) => capture.rawOriginalOwner === weakest.civ && (game.turns ?? 0) - (capture.turn ?? 0) <= 5)
  ) {
    preferredColumns.push("讣告与悼文");
  }
  if (conflictTheaters.length) preferredColumns.push("战地通讯");
  if (events.some((event) => event.kind === "全球广播")) preferredColumns.push("科学与奇观");
  preferredColumns.push("独家密电");
  preferredColumns.push("市井版");

  const editorialAngles = [
    weakest
      ? `${weakest.displayName}国势低迷，但讣告/悼文不是常规栏目；只有当本期明显围绕其败亡、失城或存亡危机时才使用。`
      : "",
    scoreLeader ? `${scoreLeader.displayName}声势居前，可以写霸权观察、元老院信心或天命叙事。` : "",
    forceLeader ? `${forceLeader.displayName}武备醒目，但公开稿不能给战术细节。` : "",
    conflictTheaters.length
      ? `本期真正值得解释的战区线索：${conflictTheaters.map((theater) => `${theater.civs.join("—")}（${theater.status}）`).join("；")}。`
      : wars.length
        ? `有公开战争素材：${wars.join("；")}。`
        : "没有适合头版的全面战争，可写“和平时期的不和平现象”。",
    "版面要正交：每个栏目尽量处理不同主题或不同文明，不要所有栏目都围绕同一个国家、同一件事反复写。",
    "本期可以把现实历史和游戏历史当作同一条时间线处理，不要刻意说“真实世界如何、游戏里如何”。",
  ].filter(Boolean);

  const strategicSignals = {
    mapPressure: mapSignals
      .filter((signal) => signal.publicSignals.length)
      .map((signal) => ({
        id: signal.id,
        civ: signal.civ,
        pressureFrom: signal.pressureFrom,
        pressureToward: signal.pressureToward,
        foreignMilitaryPressure: signal.foreignMilitaryPressure,
        barbarianPressure: signal.barbarianPressure,
        outwardProjection: signal.outwardProjection,
        publicSignals: signal.publicSignals,
      })),
    domesticTrends: trendSignals
      .filter((signal) => signal.publicSignals.length)
      .map((signal) => ({
        id: signal.id,
        civ: signal.civ,
        window: signal.window,
        militaryTrend: signal.militaryTrend,
        productionTrend: signal.productionTrend,
        scienceTrend: signal.scienceTrend,
        cultureTrend: signal.cultureTrend,
        treasuryTrend: signal.treasuryTrend,
        publicSignals: signal.publicSignals,
      })),
    worldBroadcastDigest: broadcastSignals,
    conflictTheaters,
    capturedCityLedger: captures
      .filter((capture) => capture.isMajorOriginalOwner)
      .map((capture) => ({
        year: capture.year,
        city: capture.city,
        from: capture.originalOwner,
        to: capture.currentOwner,
        cityWeight: capture.populationBand,
      })),
  };

  const sourceClaims = buildSourceClaims({ civProfiles: profiles }, mapSignals, trendSignals, broadcastSignals, conflictTheaters);

  return {
    dateline: {
      year: year.label,
      speed: year.speedName,
      currentPlayer: displayCiv(game.currentPlayer || "未知文明"),
    },
    newspaper: {
      name: "看海日报",
      availableColumns: COLUMN_DECK,
      preferredColumns: [...new Set(preferredColumns)].slice(0, 5),
      requestedStyle:
        "让 LLM 自行选择，偏假装正经的娱乐报纸。栏目不要固定化；讣告/悼文是罕见强触发栏目，不要因为有弱国就自动写。",
      layoutPolicy: [
        "每期任选 2-4 个栏目。",
        "栏目之间尽量主题正交：头版讲大战略，战地讲一个战区，经济讲另一个国家或贸易，文化/市井讲不同素材。",
        "不要所有栏目都围绕同一文明或同一事件。",
        "讣告与悼文只有在失城、亡国边缘、首都陷落或 sourceClaims 强烈支持时才写。",
      ],
    },
    editorialAngles,
    civProfiles: profiles,
    publicEvents: events,
    strategicSignals,
    sourceClaims,
    mildlySensitiveIntel: {
      allowedUse: "只能作为独家消息的氛围材料，最多写趋势，不写精确数值。",
      expertPanels: buildExpertPanels(metrics, wars, trades, conflictTheaters),
    },
    redactionPolicy: [
      "报纸中的具体事实必须能回溯到 publicEvents、strategicSignals 或 sourceClaims；不能凭空编造具体战果、工程、条约、奇观或文明关系。",
      "禁止玩家 UUID、游戏 ID、服务器、API 信息。",
      "禁止坐标、地图路线、精确兵力、单位部署、城市防御细节。",
      "禁止精确金币、科研、文化、产能、科技清单、建造队列等可直接辅助决策的信息。",
      "允许用宽泛词：高位、中游、低迷、军势醒目、边境不宁、商路活跃、文化声量较高。",
      "独家密电可以略微涉密，但必须文学化、模糊化，不得成为参谋简报。",
    ],
  };
}

function gameVersionText(game) {
  return game.version?.createdWith?.text || game.version?.text || JSON.stringify(game.version || "未知");
}

function buildSourcePack(game, brief, args) {
  return {
    schema: "kanghai-daily-source-pack/v1",
    visibility: "llm_visible",
    generatedAt: new Date().toISOString(),
    note: "brief 字段就是 ai-prompt.md 中交给 LLM 的完整脱敏 JSON 素材。metadata 仅用于本地核稿，不要求 LLM 使用。",
    metadata: {
      runDir: args.runDir,
      source: args.source,
      sourceLabel: args.source === "remote" ? `${args.server}/files/${args.gameId}` : path.resolve(args.local),
      turn: game.turns ?? null,
      year: brief.dateline?.year ?? null,
      uncivVersion: gameVersionText(game),
      baseRuleset: baseRulesetName(game),
      speed: speedName(game),
    },
    brief,
  };
}

function markdownCell(value) {
  const text = Array.isArray(value) ? value.join("、") : String(value ?? "");
  const cleaned = text.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|").trim();
  return cleaned || " ";
}

function markdownTable(headers, rows) {
  if (!rows.length) return "_无可核对记录。_\n";
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
    "",
  ].join("\n");
}

function rankLabel(ranked, civ) {
  const index = ranked.findIndex((item) => item.civ === civ);
  return index < 0 ? "无排名数据" : `${index + 1}/${ranked.length}`;
}

function metricWithRank(item, ranked, key) {
  const value = Number.isFinite(item[key]) ? item[key] : "无";
  return `${value}（${rankLabel(ranked, item.civ)}）`;
}

function panelSourceHint(panelName) {
  if (panelName === "politicalAnalyst") return "文明国势、公开战争状态";
  if (panelName === "economicAnalyst") return "城市数量、外交贸易记录";
  if (panelName === "culturalAnalyst") return "文化统计、全球广播与奇观消息";
  if (panelName === "militaryAnalyst") return "军力统计、战争/蛮族类通知";
  return "brief 中的综合素材";
}

function displayPanelName(panelName) {
  return (
    {
      politicalAnalyst: "政治专家",
      economicAnalyst: "经济专家",
      culturalAnalyst: "文化专家",
      militaryAnalyst: "军事专家",
    }[panelName] || panelName
  );
}

async function eventYearLabel(game, turn) {
  return (await gameYear({ ...game, turns: turn })).label;
}

async function buildEvidenceReport(game, brief, args, sourcePack) {
  const metrics = civMetrics(game);
  const profiles = civProfiles(metrics);
  const profileByCiv = new Map(profiles.map((profile) => [profile.civ, profile]));
  const scoreRank = rank(metrics, "score");
  const forceRank = rank(metrics, "force");
  const popRank = rank(metrics, "population");
  const cityRank = rank(metrics, "cities");
  const cultureRank = rank(metrics, "culture");
  const warRecords = activeWarRecords(game);
  const tradeRecords = activeTradeRecords(game);
  const eventRecords = publicEventRecords(game);
  const mapSignals = mapPressureSignals(game);
  const trendSignals = productionResearchCultureSignals(game);
  const captureRecords = cityCaptureRecords(game);
  for (const capture of captureRecords) {
    if (capture.turn != null) capture.year = await eventYearLabel(game, capture.turn);
  }
  const conflictTheaters = sourcePack.brief.strategicSignals?.conflictTheaters || [];
  const sourceLabel =
    args.source === "remote"
      ? `${args.server}/files/${args.gameId}`
      : path.resolve(args.local);

  const sourceRows = [
    ["数据来源", args.source === "remote" ? "联机服务器只读下载" : "本地存档", sourceLabel],
    ["存档游戏 ID", game.gameId || args.gameId || "未知", "game.gameId / --game-id"],
    ["Unciv 版本", gameVersionText(game), "game.version.createdWith.text"],
    ["当前进度", `${brief.dateline.year}，当前行动文明：${brief.dateline.currentPlayer}`, `game.turns=${game.turns}`],
    ["规则与速度", `${baseRulesetName(game)} / ${speedName(game)}`, "game.gameParameters（缺省时使用 Unciv 默认值）"],
    ["难度", game.gameParameters?.difficulty || game.difficulty || "未知", "game.gameParameters.difficulty"],
    ["模组", game.gameParameters?.mods?.join("、") || "无", "game.gameParameters.mods"],
  ];

  const sourcePackRows = [
    ["完整 LLM 可见素材", args.sourcePackOut, "source-pack.json 中的 `brief` 字段就是写入 prompt 的 JSON"],
    ["完整 LLM prompt", args.promptOut, "ai-prompt.md 是实际发送给模型的用户提示词"],
    ["公开事件数", brief.publicEvents?.length ?? 0, "`brief.publicEvents`"],
    ["地图趋势数", brief.strategicSignals?.mapPressure?.length ?? 0, "`brief.strategicSignals.mapPressure`"],
    ["内政趋势数", brief.strategicSignals?.domesticTrends?.length ?? 0, "`brief.strategicSignals.domesticTrends`"],
    ["战区态势数", brief.strategicSignals?.conflictTheaters?.length ?? 0, "`brief.strategicSignals.conflictTheaters`"],
    ["夺城记录数", brief.strategicSignals?.capturedCityLedger?.length ?? 0, "`brief.strategicSignals.capturedCityLedger`"],
    ["sourceClaims 数", brief.sourceClaims?.length ?? 0, "`brief.sourceClaims`"],
  ];

  const metricRows = metrics.map((item, index) => {
    const profile = profileByCiv.get(item.displayName);
    return [
      `CIV-${item.displayName}`,
      item.displayName,
      metricWithRank(item, scoreRank, "score"),
      metricWithRank(item, forceRank, "force"),
      metricWithRank(item, popRank, "population"),
      metricWithRank(item, cityRank, "cities"),
      metricWithRank(item, cultureRank, "culture"),
      item.techs,
      item.policies,
      profile?.postureTags?.join("、") || "无",
      [profile?.scoreBand, profile?.forceBand, profile?.populationBand, profile?.citiesBand].filter(Boolean).join("；"),
    ];
  });

  const diplomacyRows = [
    ...warRecords.map((war, index) => [
      `WAR-${String(index + 1).padStart(2, "0")}`,
      "战争状态",
      `${war.civA} vs ${war.civB}`,
      `diplomacy.diplomaticStatus = ${war.status}`,
      `brief/专家面板中写作：公开战争线索：${war.text}`,
    ]),
    ...tradeRecords.map((trade, index) => [
      `DIP-${String(index + 1).padStart(2, "0")}`,
      "贸易记录",
      `${trade.civA} 与 ${trade.civB}`,
      `双方外交记录中存在 ${trade.tradeCount} 条 trade`,
      trade.text,
    ]),
  ];

  const captureRows = captureRecords
    .filter((capture) => capture.isMajorOriginalOwner)
    .map((capture) => [
      `CAP-${capture.city}`,
      capture.year ? `${capture.year}（T${capture.turn}）` : "年代不明",
      capture.city,
      capture.originalOwner,
      capture.currentOwner,
      capture.populationBand,
      "城市归属与 turnAcquired 推导；不展示坐标。",
    ]);

  const theaterRows = conflictTheaters.map((theater) => [
    theater.id,
    theater.civs.join(" vs "),
    theater.status,
    theater.capturedCities?.map((city) => `${city.to}夺取${city.from}旧城${city.city}`).join("；") || "无夺城记录",
    theater.balance?.military || "",
    theater.balance?.production || "",
    theater.balance?.front || "",
    theater.balance?.terrain || "",
    theater.publicSignals?.join("；") || "",
  ]);

  const eventRows = [];
  for (const [index, event] of eventRecords.entries()) {
    eventRows.push([
      `EVT-${String(index + 1).padStart(2, "0")}`,
      `${await eventYearLabel(game, event.turn)}（T${event.turn}）`,
      event.sourceCiv,
      event.kind,
      event.originalText,
      event.sanitizedText,
    ]);
  }

  const mapRows = mapSignals
    .filter((signal) => signal.publicSignals.length)
    .map((signal) => [
      signal.id,
      signal.civ,
      signal.pressureFrom.join("、") || "无明显他国来源",
      signal.pressureToward.join("、") || "无明显外向目标",
      signal.foreignMilitaryPressure,
      signal.barbarianPressure,
      signal.outwardProjection,
      signal.publicSignals.join("；"),
    ]);

  const trendRows = trendSignals.map((signal) => [
    signal.id,
    signal.civ,
    signal.window,
    signal.militaryTrend,
    signal.productionTrend,
    signal.scienceTrend,
    signal.cultureTrend,
    signal.treasuryTrend,
    signal.publicSignals.join("；") || "无显著公开写作信号",
  ]);

  const panelRows = [];
  for (const [panelName, lines] of Object.entries(brief.mildlySensitiveIntel?.expertPanels || {})) {
    for (const [index, line] of lines.entries()) {
      panelRows.push([
        `${displayPanelName(panelName)}-${index + 1}`,
        line,
        panelSourceHint(panelName),
      ]);
    }
  }

  const claimRows = (brief.sourceClaims || []).map((claim) => [
    claim.id,
    claim.category,
    claim.claim,
    claim.basis,
    claim.sourceIds?.join("、") || "",
  ]);

  return `# 看海日报信源核对稿

> 内部核稿使用。这里展示的是程序从同一份 Unciv 存档中抽取到的真实看海信息，以及它们进入 LLM brief 前后的对应关系。不要直接转发到 QQ 群。
> 为避免核稿文件本身变成战术简报，本报告不列出地图坐标、单位部署路线、城市防御明细和通知 actions。
> 报纸成稿的具体事实应当能回到 \`source-pack.json\` 的 \`brief.publicEvents\`、\`brief.strategicSignals\` 或 \`brief.sourceClaims\`。

## 一、存档与版本

${markdownTable(["项目", "核对值", "来源字段"], sourceRows)}
## 二、本期 LLM 可见素材总览

${markdownTable(["项目", "核对值", "说明"], sourcePackRows)}
本期 source pack 摘要：

\`\`\`json
${JSON.stringify(
  {
    dateline: sourcePack.brief.dateline,
    preferredColumns: sourcePack.brief.newspaper?.preferredColumns,
    sourceClaimCount: sourcePack.brief.sourceClaims?.length ?? 0,
    publicEventCount: sourcePack.brief.publicEvents?.length ?? 0,
    strategicSignalCount:
      (sourcePack.brief.strategicSignals?.mapPressure?.length ?? 0) +
      (sourcePack.brief.strategicSignals?.domesticTrends?.length ?? 0) +
      (sourcePack.brief.strategicSignals?.conflictTheaters?.length ?? 0),
    conflictTheaterCount: sourcePack.brief.strategicSignals?.conflictTheaters?.length ?? 0,
    capturedCityCount: sourcePack.brief.strategicSignals?.capturedCityLedger?.length ?? 0,
  },
  null,
  2,
)}
\`\`\`

## 三、纪年换算

- 存档当前回合：T${game.turns}
- 使用速度：${speedName(game)}
- 规则集：${baseRulesetName(game)}
- 报纸使用纪年：${brief.dateline.year}
- 对应 brief 字段：\`dateline.year\`

## 四、文明指标与报纸标签

这些记录支撑 \`civProfiles\`、\`editorialAngles\` 和“独家密电”里的强弱判断。括号内为该指标在主要文明中的名次。

${markdownTable(
  ["ID", "文明", "国势分", "军力分", "人口", "城市", "文化", "科技数", "政策数", "推导标签", "进入 brief 的分层"],
  metricRows,
)}
## 五、外交、战争与贸易线索

${markdownTable(["ID", "类型", "对象", "真实看海信息", "进入 brief/报纸素材的写法"], diplomacyRows)}
## 六、夺城与城市易手台账

这些记录是战局复盘最重要的显式信息之一，只记录城市归属变化，不展示坐标。

${markdownTable(["ID", "时间", "城市", "原属", "现属", "城市量级", "依据"], captureRows)}
## 七、战区态势核对

这里把夺城记录、双方总体军势/产能、前线兵影和地形合并成脱敏战区判断。LLM 只看到比例带和趋势，不看到具体部署。

${markdownTable(
  ["ID", "双方", "状态", "夺城线索", "总体军势", "产能", "前线兵影", "地形", "进入 brief 的写法"],
  theaterRows,
)}
## 八、地图趋势核对

这些记录来自地图上的城市和军事单位位置关系，但只保留趋势带，不展示坐标、路线、单位名和具体城防细节。

${markdownTable(
  ["ID", "文明", "周边压力来源", "外向兵影对象", "他国兵影", "蛮族压力", "外向投射", "进入 brief 的写法"],
  mapRows,
)}
## 九、军备、科研、文化与财政趋势

这些记录来自最近若干回合的统计变化。LLM 只看到趋势词，不看到具体差值；这里也不列城市坐标和建造队列。

${markdownTable(
  ["ID", "文明", "窗口", "军备", "产能", "科研", "文化", "财政", "进入 brief 的写法"],
  trendRows,
)}
## 十、近期通知核对

这些记录来自各文明 \`notificationsLog\` 中最近若干回合、且被程序判定为适合进入报纸素材池的通知。左侧是真实通知文本，右侧是进入 brief 前的降敏写法。

${markdownTable(["ID", "时间", "来源文明", "类别", "真实通知文本", "进入 brief 的写法"], eventRows)}
## 十一、sourceClaims 核对

这些是 LLM 最应该依赖的事实陈述。报纸里的具体事实如果离开这些 sourceClaims，就应该视为模型发挥。

${markdownTable(["ID", "类别", "可用事实", "依据", "来源 ID"], claimRows)}
## 十二、专家面板来源

这些内容会进入 \`mildlySensitiveIntel.expertPanels\`，供“独家密电”栏目使用。它们允许略微涉密，但仍应写成趋势、传闻和隐喻。

${markdownTable(["ID", "brief 中的专家素材", "主要依据"], panelRows)}
## 十三、核稿办法

1. 报纸中关于强国、弱国、霸权气氛的判断，优先核对“四、文明指标与报纸标签”。
2. 报纸中关于战争、夺城、战况、前线态势、地形的内容，优先核对“六、夺城与城市易手台账”和“七、战区态势核对”。
3. 报纸中关于边境压力、蛮族活动、前线交火的内容，优先核对“八、地图趋势核对”和“十、近期通知核对”。
4. 报纸中关于奇观、时代变化、科研、城市发展、市政工程的内容，优先核对“九、军备、科研、文化与财政趋势”和“十、近期通知核对”。
5. 报纸中如果出现找不到对应证据的具体事实，那就是 LLM 的文学发挥，发布前应人工改掉或删掉。
`;
}

async function buildPrompt(brief, args) {
  const templatePath = path.join(PROJECT_DIR, "prompts", "newspaper-writer.md");
  const template = await fs.readFile(templatePath, "utf8");
  const styleHint = args.style === "auto" ? "由你根据素材选择最有梗的栏目组合。" : `本期倾向文体/栏目：${args.style}`;
  return `${template}

---

本期要求：

- ${styleHint}
- 必须使用纪年：${brief.dateline.year}，不要写回合数。
- 所有具体事实只能来自 brief.publicEvents、brief.strategicSignals、brief.sourceClaims 和 mildlySensitiveIntel.expertPanels；不要凭空增加具体战果、条约、工程、奇观、文明关系或城市状态。
- brief.sourceClaims 是事实锚点；可以文学化改写，但不要在公开稿里输出 SRC 编号。
- 不要写“来自某方向”“沿某路”“逼近某城”“某城附近”这类方向性或位置性暗示。
- 版面不能固定化。栏目之间尽量主题正交，不要所有栏目都写同一个国家或同一件事。
- 讣告与悼文是罕见栏目，只有失城、首都陷落、亡国边缘或 brief 明确强烈支持时才写。
- 除纪年和报纸期号外，不要写任何看似精确的次数、数量、排名或清单。
- 可以从固定栏目中选 2-4 个，但不要机械铺满所有栏目。
- 正文全部由你撰写；不要输出 JSON，不要列数据表。

下面是程序清洗后的脱敏 brief：

\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`
`;
}

async function callAnthropic(prompt, args, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY. Put it in kanghai-daily/.env or the process environment.");
  }
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";
  const payload = {
    model,
    max_tokens: options.maxTokens ?? args.maxTokens,
    temperature: options.temperature ?? args.temperature,
    system: options.system || "你是看海日报总编辑。只输出可直接发到 QQ 群的中文报纸稿，不输出解释。",
    messages: [{ role: "user", content: prompt }],
  };

  const response = await postJson(
    `${baseUrl}/v1/messages`,
    {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    payload,
  );

  const text = extractResponseText(response);
  if (!text.trim()) {
    throw new Error(`LLM response contained no extractable text; keys=${Object.keys(response).join(",")}`);
  }
  return {
    text,
    meta: {
      model: response.model || model,
      usage: response.usage || null,
      stopReason: response.stop_reason || null,
      responseKeys: Object.keys(response),
    },
  };
}

function buildFactCheckPrompt(sourcePack, paper) {
  return `请基于下面的 source pack 审核《看海日报》成稿是否可靠。

审核原则：
- 只检查事实可靠性和泄密风险，不评价文采。
- 具体事实必须能回到 brief.publicEvents、brief.strategicSignals、brief.sourceClaims 或 mildlySensitiveIntel.expertPanels。
- 文学性比喻、社论夸张、广告梗可以保留，但如果它伪装成具体事实却找不到来源，要标为“需改”。
- 如果出现坐标、路线、精确兵力、精确经济科研文化数值、建造队列、城市防御细节，要标为“泄密风险”。
- 输出中文 Markdown，包含：总体结论、可追溯事实、需人工修改、泄密风险、发布建议。

source pack:
\`\`\`json
${JSON.stringify(sourcePack.brief, null, 2)}
\`\`\`

成稿：
\`\`\`markdown
${paper}
\`\`\`
`;
}

async function factCheckPaper(sourcePack, paper, args) {
  return callAnthropic(buildFactCheckPrompt(sourcePack, paper), args, {
    maxTokens: Math.min(args.maxTokens, 1400),
    temperature: 0.1,
    system: "你是看海日报的事实核验编辑。只输出中文 Markdown 审核意见，不改写正文。",
  });
}

function extractResponseText(response) {
  if (!response || typeof response !== "object") return "";
  if (typeof response.output_text === "string") return response.output_text;
  if (typeof response.completion === "string") return response.completion;
  if (typeof response.text === "string") return response.text;

  const anthropicText = extractAnthropicText(response.content);
  if (anthropicText) return anthropicText;

  const choice = response.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (Array.isArray(choice?.message?.content)) return extractAnthropicText(choice.message.content);
  if (typeof choice?.text === "string") return choice.text;

  if (Array.isArray(response.output)) {
    return response.output
      .map((item) => extractAnthropicText(item?.content) || item?.text || "")
      .filter(Boolean)
      .join("");
  }
  return "";
}

function extractAnthropicText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (typeof block?.text === "string") return block.text;
      if (typeof block?.content === "string") return block.content;
      return "";
    })
    .filter(Boolean)
    .join("");
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

async function readJsonIfPresent(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function allWorldBroadcastRecords(game) {
  const bySummary = new Map();
  for (const civ of getMajorCivs(game)) {
    for (const log of civ.notificationsLog || []) {
      for (const notification of log.notifications || []) {
        const text = unwrap(notification.text);
        const isWorld = /has been built in a faraway land|has entered the .* era|has enhanced .*|World Congress/i.test(text);
        if (!isWorld) continue;
        const sanitized = sanitizeEventText(text);
        const current = bySummary.get(sanitized);
        const next = {
          turn: log.turn,
          kind: "全球广播",
          civ: "世界广播",
          summary: sanitized,
        };
        if (!current || (next.turn ?? Infinity) < (current.turn ?? Infinity)) bySummary.set(sanitized, next);
      }
    }
  }
  return [...bySummary.values()].sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
}

async function buildTimelineEntries(game, brief) {
  const entries = [];
  for (const event of allWorldBroadcastRecords(game)) {
    const year = await eventYearLabel(game, event.turn);
    entries.push({
      key: `world|${event.turn}|${event.summary}`,
      turn: event.turn,
      year,
      category: event.kind,
      civ: event.civ,
      summary: event.summary,
      importance: "major",
      source: "world_broadcast",
      privacy: "sanitized",
    });
  }

  for (const capture of cityCaptureRecords(game).filter((item) => item.isMajorOriginalOwner)) {
    const year = capture.turn == null ? "年代不明" : await eventYearLabel(game, capture.turn);
    entries.push({
      key: `capture|${capture.turn}|${capture.city}|${capture.rawOriginalOwner}|${capture.rawCurrentOwner}`,
      turn: capture.turn,
      year,
      category: "城市易手",
      civ: `${capture.originalOwner}→${capture.currentOwner}`,
      summary: `${capture.currentOwner}夺取${capture.originalOwner}旧城${capture.city}`,
      importance: "major",
      source: "city_owner_and_turnAcquired",
      privacy: "city_level_sanitized",
    });
  }

  return entries;
}

function renderTimelineMarkdown(entries) {
  const sorted = [...entries].sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0) || a.category.localeCompare(b.category, "zh-Hans-CN"));
  const lines = [
    "# 看海日报大事记",
    "",
    "> 这份文件只记录足以改变局势或值得复盘的大事件。普通边境提示、城市涨人口、零散蛮族消息不会进入这里。",
    "",
  ];
  let lastTurn = null;
  for (const entry of sorted) {
    if (entry.turn !== lastTurn) {
      lastTurn = entry.turn;
      lines.push(`## T${entry.turn} / ${entry.year}`);
      lines.push("");
    }
    lines.push(`- ${entry.category}｜${entry.civ}：${entry.summary}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function updateTimeline(game, brief, args) {
  if (args.noTimeline) return null;
  const existing = await readJsonIfPresent(args.timelineJsonOut, { schema: "kanghai-daily-major-timeline/v2", entries: [] });
  const entries = existing.schema === "kanghai-daily-major-timeline/v2" ? existing.entries || [] : [];
  const timelineKey = (entry) => (entry.category === "全球广播" ? `world|${entry.summary}` : entry.key);
  const keepTimelineEntry = (entry) => ["全球广播", "城市易手"].includes(entry.category);
  const byKey = new Map();
  for (const entry of entries) {
    if (!keepTimelineEntry(entry)) continue;
    const key = timelineKey(entry);
    const current = byKey.get(key);
    if (!current || (entry.turn ?? Infinity) < (current.turn ?? Infinity)) {
      byKey.set(key, { ...entry, key });
    }
  }
  for (const entry of await buildTimelineEntries(game, brief)) {
    const key = timelineKey(entry);
    const current = byKey.get(key);
    if (!current || (entry.turn ?? Infinity) < (current.turn ?? Infinity)) byKey.set(key, { ...entry, key });
  }
  const next = {
    schema: "kanghai-daily-major-timeline/v2",
    updatedAt: new Date().toISOString(),
    entries: [...byKey.values()].sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0) || a.summary.localeCompare(b.summary, "zh-Hans-CN")),
  };
  await writeFile(args.timelineJsonOut, `${JSON.stringify(next, null, 2)}\n`);
  await writeFile(args.timelineOut, renderTimelineMarkdown(next.entries));
  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvironment();
  const game = await loadGame(args);
  const brief = await buildBrief(game);
  resolveOutputPaths(args, game, brief);
  const sourcePack = buildSourcePack(game, brief, args);
  const prompt = await buildPrompt(brief, args);
  const evidence = await buildEvidenceReport(game, brief, args, sourcePack);

  await writeFile(args.briefOut, `${JSON.stringify(brief, null, 2)}\n`);
  await writeFile(args.sourcePackOut, `${JSON.stringify(sourcePack, null, 2)}\n`);
  await writeFile(args.promptOut, prompt);
  await writeFile(args.evidenceOut, evidence);
  const timeline = await updateTimeline(game, brief, args);

  if (args.noLlm) {
    console.log(`Wrote ${args.briefOut}`);
    console.log(`Wrote ${args.sourcePackOut}`);
    console.log(`Wrote ${args.promptOut}`);
    console.log(`Wrote ${args.evidenceOut}`);
    if (timeline) {
      console.log(`Updated ${args.timelineOut}`);
      console.log(`Updated ${args.timelineJsonOut}`);
    }
    console.log("Skipped LLM call because --no-llm was set.");
    return;
  }

  const result = await callAnthropic(prompt, args);
  const paper = result.text.trim();
  await writeFile(args.out, `${paper}\n`);
  await writeFile(args.rawOut, `${JSON.stringify(result.meta, null, 2)}\n`);
  if (!args.noFactCheck) {
    const factCheck = await factCheckPaper(sourcePack, paper, args);
    await writeFile(args.factCheckOut, `${factCheck.text.trim()}\n`);
    await writeFile(args.factRawOut, `${JSON.stringify(factCheck.meta, null, 2)}\n`);
  }
  console.log(`Wrote ${args.out}`);
  console.log(`Wrote ${args.briefOut}`);
  console.log(`Wrote ${args.sourcePackOut}`);
  console.log(`Wrote ${args.promptOut}`);
  console.log(`Wrote ${args.evidenceOut}`);
  console.log(`Wrote ${args.rawOut}`);
  if (!args.noFactCheck) {
    console.log(`Wrote ${args.factCheckOut}`);
    console.log(`Wrote ${args.factRawOut}`);
  }
  if (timeline) {
    console.log(`Updated ${args.timelineOut}`);
    console.log(`Updated ${args.timelineJsonOut}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
