const state = {
  manifest: null,
  issue: null,
  gameId: "",
  issueId: "",
};

const nodes = {
  gameSelect: document.querySelector("#gameSelect"),
  issueSelect: document.querySelector("#issueSelect"),
  archiveList: document.querySelector("#archiveList"),
  newspaper: document.querySelector("#newspaper"),
  copyImageButton: document.querySelector("#copyImageButton"),
  downloadImageButton: document.querySelector("#downloadImageButton"),
  shareStatus: document.querySelector("#shareStatus"),
};

const blockRenderers = {
  paragraph(block) {
    return richTextNode("p", block.text);
  },
  quote(block) {
    return richTextNode("blockquote", block.text);
  },
  subhead(block) {
    return el("h4", {}, cleanText(block.text));
  },
  list(block) {
    const list = el("ul");
    for (const item of block.items || []) list.append(richTextNode("li", item));
    return list;
  },
};

init().catch((error) => {
  nodes.newspaper.replaceChildren(el("div", { className: "loading error" }, `页面数据加载失败：${error.message}`));
});

async function init() {
  state.manifest = await fetchJson("data/manifest.json");
  const params = new URLSearchParams(location.search);
  const latest = state.manifest.latest;
  state.gameId = params.get("game") || latest.gameId;
  state.issueId = params.get("issue") || latest.issueId;

  bindControls();
  bindShareActions();
  await loadIssue(state.issueId);
}

function bindControls() {
  nodes.gameSelect.replaceChildren();
  for (const game of state.manifest.games) {
    nodes.gameSelect.append(el("option", { value: game.id }, game.name));
  }
  nodes.gameSelect.value = state.gameId;
  nodes.gameSelect.addEventListener("change", async () => {
    const game = findGame(nodes.gameSelect.value);
    state.gameId = game.id;
    state.issueId = game.latestIssueId;
    renderIssueSelect();
    await loadIssue(state.issueId);
  });

  nodes.issueSelect.addEventListener("change", async () => {
    state.issueId = nodes.issueSelect.value;
    await loadIssue(state.issueId);
  });

  renderIssueSelect();
}

function bindShareActions() {
  nodes.copyImageButton.dataset.defaultLabel = nodes.copyImageButton.textContent;
  nodes.downloadImageButton.dataset.defaultLabel = nodes.downloadImageButton.textContent;
  nodes.copyImageButton.addEventListener("click", () => exportPaperImage("copy"));
  nodes.downloadImageButton.addEventListener("click", () => exportPaperImage("download"));
}

function renderIssueSelect() {
  const game = findGame(state.gameId);
  nodes.issueSelect.replaceChildren();
  for (const issue of game.issues) {
    nodes.issueSelect.append(el("option", { value: issue.id }, issueLabel(issue)));
  }
  nodes.issueSelect.value = state.issueId;
}

async function loadIssue(issueId) {
  state.issue = await fetchJson(`data/issues/${issueId}.json`);
  state.gameId = state.issue.gameId;
  state.issueId = issueId;
  nodes.gameSelect.value = state.gameId;
  renderIssueSelect();
  nodes.issueSelect.value = state.issueId;
  renderArchive();
  renderPaper();
  updateUrl();
  nodes.shareStatus.textContent = "";
  restoreButtonLabel(nodes.copyImageButton);
  restoreButtonLabel(nodes.downloadImageButton);
}

function renderArchive() {
  const game = findGame(state.gameId);
  nodes.archiveList.replaceChildren();
  for (const issue of game.issues) {
    const button = el("button", {
      className: `archive-item${issue.id === state.issueId ? " is-active" : ""}`,
      type: "button",
      "aria-current": issue.id === state.issueId ? "true" : "false",
    });
    button.append(
      el("span", { className: "archive-date" }, cleanText(issue.dateline || issue.year || "未署年")),
      el("strong", {}, cleanText(issue.title)),
      el("small", {}, issue.turn == null ? issue.id : `T${String(issue.turn).padStart(3, "0")}`),
    );
    button.addEventListener("click", () => loadIssue(issue.id));
    nodes.archiveList.append(button);
  }
}

function renderPaper() {
  const issue = state.issue;
  document.title = `${issue.paperName} - ${issue.dateline}`;
  const layout = chooseLayout(issue);
  nodes.newspaper.dataset.layout = layout.name;
  nodes.newspaper.style.setProperty("--paper-max", `${layout.maxWidth}px`);
  nodes.newspaper.style.setProperty("--lead-columns", String(layout.leadColumns));
  nodes.newspaper.style.setProperty("--body-columns", String(layout.bodyColumns));

  const masthead = el("header", { className: "masthead" });
  masthead.append(
    el("div", { className: "masthead-rule" }),
    el("h1", {}, cleanText(issue.paperName)),
    el("div", { className: "edition-line" },
      el("span", {}, `对局 ${issue.gameShortId || issue.gameId}`),
      el("span", {}, cleanText(issue.dateline)),
      el("span", {}, `主笔 ${cleanText(issue.byline || "潮汐边的执笔人")}`),
    ),
    el("div", { className: "masthead-rule thin" }),
  );

  const [lead, ...rest] = issueSections(issue);
  const body = el("div", { className: "paper-body" });
  if (lead) body.append(renderLeadSection(lead, layout));
  if (rest.length) {
    const columns = el("div", { className: "news-columns" });
    const balanced = balanceSections([...rest, ...makeFillerSections(issue, layout, rest)], layout.bodyColumns);
    for (const columnSections of balanced) {
      const column = el("div", { className: "news-column" });
      for (const section of columnSections) column.append(renderColumnSection(section));
      columns.append(column);
    }
    body.append(columns);
  }
  if (issue.editorNote?.text) {
    body.append(
      el("section", { className: "editor-note" },
        el("h3", {}, cleanText(issue.editorNote.title || "本报编辑部按")),
        richTextNode("p", issue.editorNote.text),
      ),
    );
  }

  const footer = el("footer", { className: "paper-footer" });
  footer.append(
    el("span", {}, `对局 ${issue.gameShortId || issue.gameId}`),
    el("span", {}, issue.turn == null ? "未署期" : `T${String(issue.turn).padStart(3, "0")}`),
  );

  nodes.newspaper.replaceChildren(masthead, body, footer);
}

function chooseLayout(issue) {
  const resolvedSections = issueSections(issue);
  const length = issueTextLength(issue);
  const sections = resolvedSections.length;
  const restSections = Math.max(0, sections - 1);
  const leadWeight = resolvedSections[0] ? sectionWeight(resolvedSections[0]) : 0;
  const score = length + restSections * 120;
  let bodyColumns = 1;
  if (restSections >= 2) bodyColumns = 2;
  if (restSections >= 5 && score > 2400) bodyColumns = 3;
  if (restSections >= 6 && score > 2000) bodyColumns = 3;
  const leadColumns = leadWeight < 260 || bodyColumns === 1 ? 1 : Math.min(bodyColumns, leadWeight > 520 ? 3 : 2);
  if (score < 1150) {
    return { name: "compact", maxWidth: bodyColumns > 1 ? 820 : 700, leadColumns, bodyColumns, score };
  }
  if (score < 2050) {
    return { name: "balanced", maxWidth: bodyColumns > 2 ? 1020 : 900, leadColumns, bodyColumns, score };
  }
  return { name: "broadsheet", maxWidth: 1060, leadColumns, bodyColumns, score };
}

function issueTextLength(issue) {
  return issueSections(issue).reduce((sum, section) => sum + sectionWeight(section), issue.editorNote?.text?.length || 0);
}

function issueSections(issue) {
  return issue.sections || [];
}

function sectionWeight(section) {
  const blockText = (section.blocks || []).map((block) => cleanText(block.text || (block.items || []).join("") || "")).join("");
  return blockText.length + cleanText(section.headline).length * 2 + cleanText(section.kicker).length;
}

function blockWeight(block) {
  if (!block) return 0;
  if (block.type === "list") return cleanText((block.items || []).join("")).length + (block.items || []).length * 16;
  return cleanText(block.text).length + (block.type === "subhead" ? 32 : 0) + (block.type === "quote" ? 26 : 0);
}

function balanceSections(sections, columnCount) {
  const columns = Array.from({ length: columnCount }, () => ({ weight: 0, sections: [] }));
  for (const section of sections) {
    const target = columns.reduce((best, column) => (column.weight < best.weight ? column : best), columns[0]);
    target.sections.push(section);
    target.weight += sectionWeight(section);
  }
  return columns.map((column) => column.sections);
}

function balanceBlocks(blocks, columnCount) {
  const usableColumns = Math.max(1, Math.min(columnCount, Math.max(1, blocks.length)));
  const columns = Array.from({ length: usableColumns }, () => ({ weight: 0, blocks: [] }));
  for (const block of blocks) {
    const target = columns.reduce((best, column) => (column.weight < best.weight ? column : best), columns[0]);
    target.blocks.push(block);
    target.weight += blockWeight(block);
  }
  return columns.map((column) => column.blocks);
}

function makeFillerSections(issue, layout = chooseLayout(issue), restSections = issueSections(issue).slice(1)) {
  if (layout.bodyColumns <= 1 || !restSections.length) return [];
  if (restSections.length >= layout.bodyColumns && restSections.length % layout.bodyColumns === 0) return [];
  const weights = balanceSections(restSections, layout.bodyColumns)
    .map((sections) => sections.reduce((sum, section) => sum + sectionWeight(section), 0));
  const tallest = Math.max(...weights, 0);
  const shortest = Math.min(...weights, 0);
  const gap = tallest - shortest;
  const hasEmptyColumn = restSections.length < layout.bodyColumns;
  const hasLargeGap = gap > Math.max(140, tallest * 0.32);
  if (!hasEmptyColumn && !hasLargeGap) return [];
  const take = gap > 280 ? 3 : gap > 180 ? 2 : 1;
  const events = (issue.summary?.events || []).slice(0, take);
  if (!events.length) return [];
  return [{
    id: "filler-wire",
    kicker: "报缝短讯",
    headline: "驿路拾闻",
    blocks: [{
      type: "paragraph",
      text: events.map((event) => `${event.year || issue.year}：${event.text}`).join("；"),
    }],
  }];
}

function renderLeadSection(section, layout) {
  const article = el("section", { className: "lead-story" });
  const headline = el("div", { className: "lead-headline" },
    el("div", { className: "kicker" }, cleanText(section.kicker)),
    el("h2", {}, cleanText(section.headline)),
  );
  const body = el("div", { className: "article-body lead-copy text-columns" });
  const balanced = balanceBlocks(section.blocks || [], layout.leadColumns);
  body.style.setProperty("--text-columns", String(balanced.length));
  for (const columnBlocks of balanced) {
    const column = el("div", { className: "text-column" });
    renderBlocks(column, columnBlocks);
    body.append(column);
  }
  article.append(headline, body);
  return article;
}

function renderColumnSection(section) {
  const article = el("section", { className: "column-article" });
  article.append(
    el("div", { className: "kicker" }, cleanText(section.kicker)),
    el("h3", {}, cleanText(section.headline)),
  );
  const body = el("div", { className: "article-body" });
  renderBlocks(body, section.blocks || []);
  article.append(body);
  return article;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function richTextNode(tagName, value) {
  const node = el(tagName);
  appendRichText(node, value);
  return node;
}

function appendRichText(node, value) {
  const text = cleanText(value);
  const match = /^([^：:\n]{2,14})([：:])\s*(.+)$/.exec(text);
  if (!match || /[，。；！？、,.!?]/.test(match[1])) {
    node.append(text);
    return;
  }
  node.append(el("strong", { className: "inline-label" }, `${match[1]}${match[2]}`), document.createTextNode(match[3]));
}

function renderBlocks(parent, blocks) {
  for (const block of blocks) {
    const render = blockRenderers[block.type] || blockRenderers.paragraph;
    parent.append(render(block));
  }
}

async function exportPaperImage(mode) {
  const activeButton = mode === "copy" ? nodes.copyImageButton : nodes.downloadImageButton;
  setShareBusy(true, activeButton, mode === "copy" ? "正在复制..." : "正在生成...");
  try {
    const image = await renderPaperImage();
    if (mode === "copy") {
      const result = await copyImageOrFallback(image);
      setShareBusy(false, activeButton);
      showButtonFeedback(activeButton, result.label);
      nodes.shareStatus.textContent = result.status;
    } else {
      downloadBlob(image.blob, `${cleanFilename(state.issue.paperName)}-${state.issue.id}.${image.extension}`);
      setShareBusy(false, activeButton);
      showButtonFeedback(activeButton, "已下载");
      nodes.shareStatus.textContent = "PNG 报纸图已开始下载。";
    }
  } catch (error) {
    setShareBusy(false, activeButton);
    showButtonFeedback(activeButton, "生成失败");
    nodes.shareStatus.textContent = `图片生成失败：${error.message}`;
  }
}

function setShareBusy(isBusy, activeButton = null, label = "") {
  for (const button of [nodes.copyImageButton, nodes.downloadImageButton]) {
    button.disabled = isBusy;
    if (!isBusy && button !== activeButton) restoreButtonLabel(button);
  }
  if (activeButton && label) activeButton.textContent = label;
  if (label) nodes.shareStatus.textContent = label;
}

function showButtonFeedback(button, label) {
  window.clearTimeout(Number(button.dataset.feedbackTimer || 0));
  button.textContent = label;
  const timer = window.setTimeout(() => restoreButtonLabel(button), 1800);
  button.dataset.feedbackTimer = String(timer);
}

function restoreButtonLabel(button) {
  if (!button?.dataset.defaultLabel) return;
  window.clearTimeout(Number(button.dataset.feedbackTimer || 0));
  button.textContent = button.dataset.defaultLabel;
  button.dataset.feedbackTimer = "";
}

async function renderPaperImage() {
  await document.fonts?.ready;
  const canvas = await renderElementToCanvas(nodes.newspaper, 3);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Canvas 没有生成 PNG。"));
    }, "image/png");
  });
  return {
    blob,
    extension: "png",
    mime: "image/png",
  };
}

async function copyImageOrFallback(image) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [image.mime]: image.blob })]);
      return { label: "已复制", status: "PNG 报纸图已复制到剪贴板。" };
    } catch {
      downloadBlob(image.blob, `${cleanFilename(state.issue.paperName)}-${state.issue.id}.${image.extension}`);
      return { label: "已下载PNG", status: "当前浏览器限制复制图片，已改为下载 PNG。" };
    }
  }
  downloadBlob(image.blob, `${cleanFilename(state.issue.paperName)}-${state.issue.id}.${image.extension}`);
  return { label: "已下载PNG", status: "当前浏览器不支持图片剪贴板，已改为下载 PNG。" };
}

async function renderElementToCanvas(element, scale = 3) {
  if (!window.html2canvas) throw new Error("图片渲染器尚未加载。");
  const rect = element.getBoundingClientRect();
  return window.html2canvas(element, {
    backgroundColor: "#ead8ad",
    scale,
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: Math.ceil(document.documentElement.scrollWidth),
    windowHeight: Math.ceil(document.documentElement.scrollHeight),
    useCORS: true,
    logging: false,
    onclone(clonedDocument) {
      const clonedPaper = clonedDocument.querySelector("#newspaper");
      if (clonedPaper) {
        clonedPaper.style.margin = "0";
        clonedPaper.style.boxShadow = "none";
        clonedPaper.style.backgroundColor = "#ead8ad";
        clonedPaper.style.color = "#17130e";
      }
    },
  });
}

function cleanFilename(value) {
  return cleanText(value || "看海日报").replace(/[\\/:*?"<>|]/g, "-") || "看海日报";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawPaperCanvas(issue) {
  const layout = measureCanvasLayout(issue);
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = layout.width * ratio;
  canvas.height = layout.height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  drawPaperBackground(ctx, layout.width, layout.height);
  drawCanvasIssue(ctx, issue, layout);
  return canvas;
}

function measureCanvasLayout(issue) {
  const metrics = buildCanvasMetrics(issue, document.createElement("canvas").getContext("2d"));
  return { ...metrics, height: metrics.height };
}

function buildCanvasMetrics(issue, ctx) {
  const paperLayout = chooseLayout(issue);
  const width = canvasWidthForLayout(paperLayout);
  const pad = 70;
  const inner = width - pad * 2;
  let y = 64;
  y += 184;
  y += 18;

  const lead = issueSections(issue)[0];
  if (lead) {
    y += 28;
    ctx.font = canvasFont(92, 900);
    y += wrapCanvasText(ctx, lead.headline, inner, 92, true).height + 22;
    y += measureColumns(ctx, blocksToParagraphs(lead.blocks), inner, paperLayout.leadColumns, 22, 27, canvasFont(25, 500));
    y += 28;
  }

  const rest = [...issueSections(issue).slice(1), ...makeFillerSections(issue, paperLayout)];
  const columnCount = Math.max(1, paperLayout.bodyColumns);
  const balanced = balanceSections(rest, columnCount);
  const colGap = 28;
  const colW = (inner - colGap * (columnCount - 1)) / columnCount;
  const columnHeights = balanced.map((sections) => {
    let h = 0;
    for (const section of sections) {
      h += 24;
      ctx.font = canvasFont(42, 900);
      h += wrapCanvasText(ctx, section.headline, colW, 42, true).height + 14;
      h += measureParagraphs(ctx, blocksToParagraphs(section.blocks), colW, 24, canvasFont(24, 500)) + 24;
    }
    return h;
  });
  y += Math.max(...columnHeights, 0);

  if (issue.editorNote?.text) {
    y += 26;
    y += 42 + measureParagraphs(ctx, [issue.editorNote.text], inner - 32, 25, canvasFont(25, 500));
  }
  y += 88;

  return { width, height: Math.ceil(y), pad, inner, colGap, colW, columnCount, paperLayout };
}

function canvasWidthForLayout(layout) {
  if (layout.name === "compact") return layout.bodyColumns > 1 ? 1080 : 900;
  if (layout.name === "balanced") return layout.bodyColumns > 2 ? 1280 : 1160;
  return 1360;
}

function drawPaperBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f3e7c8");
  gradient.addColorStop(0.55, "#e7d5aa");
  gradient.addColorStop(1, "#dec48e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(58,41,24,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 18) line(ctx, x, 0, x, height);
  for (let y = 0; y < height; y += 18) line(ctx, 0, y, width, y);
  ctx.strokeStyle = "rgba(52,36,21,0.56)";
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, width - 32, height - 32);
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, width - 48, height - 48);
}

function drawCanvasIssue(ctx, issue, layout) {
  const { width, pad, inner, colGap, colW, columnCount, paperLayout } = layout;
  let y = 64;
  ctx.strokeStyle = "#1a1712";
  ctx.lineWidth = 3;
  line(ctx, pad, y, width - pad, y);
  ctx.lineWidth = 1;
  line(ctx, pad, y + 9, width - pad, y + 9);
  y += 34;
  ctx.fillStyle = "#1a1712";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = canvasFont(128, 900);
  ctx.fillText(cleanText(issue.paperName || "看海日报"), width / 2, y + 110);
  y += 142;
  ctx.font = canvasFont(24, 700);
  ctx.fillStyle = "#4e4539";
  ctx.textAlign = "left";
  ctx.fillText(`对局 ${issue.gameShortId || issue.gameId}`, pad, y);
  ctx.textAlign = "center";
  ctx.fillText(cleanText(issue.dateline || issue.year), width / 2, y);
  ctx.textAlign = "right";
  ctx.fillText(`主笔 ${cleanText(issue.byline || "潮汐边的执笔人")}`, width - pad, y);
  y += 16;
  ctx.strokeStyle = "rgba(38,29,20,0.55)";
  ctx.lineWidth = 2;
  line(ctx, pad, y, width - pad, y);
  ctx.lineWidth = 1;
  line(ctx, pad, y + 8, width - pad, y + 8);
  y += 34;

  const lead = issueSections(issue)[0];
  if (lead) {
    drawKicker(ctx, lead.kicker, pad, y);
    y += 30;
    ctx.fillStyle = "#1a1712";
    ctx.font = canvasFont(92, 900);
    ctx.textAlign = "left";
    y += drawWrappedCanvasText(ctx, lead.headline, pad, y, inner, 96, { font: canvasFont(92, 900) }) + 18;
    y += drawColumns(ctx, blocksToParagraphs(lead.blocks), pad, y, inner, paperLayout.leadColumns, 22, 27, canvasFont(25, 500));
    y += 22;
    drawDoubleRule(ctx, pad, y, width - pad);
    y += 28;
  }

  const rest = [...issueSections(issue).slice(1), ...makeFillerSections(issue, paperLayout)];
  const balanced = balanceSections(rest, columnCount);
  const startY = y;
  const bottomYs = [];
  balanced.forEach((sections, index) => {
    let cy = startY;
    const x = pad + index * (colW + colGap);
    for (const section of sections) {
      drawDoubleRule(ctx, x, cy, x + colW);
      cy += 22;
      drawKicker(ctx, section.kicker, x, cy);
      cy += 27;
      ctx.fillStyle = "#1a1712";
      cy += drawWrappedCanvasText(ctx, section.headline, x, cy, colW, 44, { font: canvasFont(42, 900) }) + 10;
      cy += drawParagraphs(ctx, blocksToParagraphs(section.blocks), x, cy, colW, 24, canvasFont(24, 500)) + 18;
    }
    bottomYs.push(cy);
  });
  y = Math.max(...bottomYs, y);
  for (let index = 1; index < columnCount; index += 1) {
    const x = pad + index * colW + (index - 0.5) * colGap;
    ctx.strokeStyle = "rgba(42,31,20,0.28)";
    ctx.lineWidth = 1;
    line(ctx, x, startY, x, y);
  }

  if (issue.editorNote?.text) {
    y += 20;
    drawDoubleRule(ctx, pad, y, width - pad);
    y += 28;
    drawKicker(ctx, issue.editorNote.title || "本报编辑部按", pad + 18, y);
    y += 32;
    y += drawParagraphs(ctx, [issue.editorNote.text], pad + 18, y, inner - 36, 25, canvasFont(25, 500));
  }
  y += 30;
  drawDoubleRule(ctx, pad, y, width - pad);
  y += 36;
  ctx.font = canvasFont(18, 500);
  ctx.fillStyle = "#5a4d3c";
  ctx.textAlign = "left";
  ctx.fillText(`对局 ${issue.gameShortId || issue.gameId}`, pad, y);
  ctx.textAlign = "right";
  ctx.fillText(issue.turn == null ? "未署期" : `T${String(issue.turn).padStart(3, "0")}`, width - pad, y);
}

function canvasFont(size, weight = 500) {
  return `${weight} ${size}px "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif`;
}

function drawKicker(ctx, text, x, y) {
  ctx.font = canvasFont(20, 900);
  ctx.fillStyle = "#7c2e24";
  ctx.textAlign = "left";
  ctx.fillText(cleanText(text), x, y);
}

function blocksToParagraphs(blocks = []) {
  const paragraphs = [];
  for (const block of blocks) {
    if (block.type === "list") paragraphs.push(...(block.items || []).map(cleanText));
    else if (block.text) paragraphs.push(cleanText(block.text));
  }
  return paragraphs;
}

function measureParagraphs(ctx, paragraphs, width, lineHeight, font) {
  ctx.font = font;
  return paragraphs.reduce((sum, text) => sum + wrapCanvasText(ctx, text, width, lineHeight).height + 12, 0);
}

function drawParagraphs(ctx, paragraphs, x, y, width, lineHeight, font) {
  ctx.font = font;
  ctx.fillStyle = "#2f271d";
  ctx.textAlign = "left";
  let cy = y;
  for (const text of paragraphs) {
    cy += drawWrappedCanvasText(ctx, text, x, cy, width, lineHeight, { font }) + 12;
  }
  return cy - y;
}

function measureColumns(ctx, paragraphs, width, count, gap, lineHeight, font) {
  const colW = (width - gap * (count - 1)) / count;
  const heights = Array.from({ length: count }, () => 0);
  paragraphs.forEach((text, index) => {
    const h = wrapCanvasText(ctx, text, colW, lineHeight, false, font).height + 12;
    const target = heights.indexOf(Math.min(...heights));
    heights[target] += h;
    if (index === 0 && paragraphs.length >= count) heights[target] += 0;
  });
  return Math.max(...heights, 0);
}

function drawColumns(ctx, paragraphs, x, y, width, count, gap, lineHeight, font) {
  const colW = (width - gap * (count - 1)) / count;
  const colYs = Array.from({ length: count }, () => y);
  ctx.font = font;
  paragraphs.forEach((text) => {
    const target = colYs.indexOf(Math.min(...colYs));
    const cx = x + target * (colW + gap);
    colYs[target] += drawWrappedCanvasText(ctx, text, cx, colYs[target], colW, lineHeight, { font }) + 12;
  });
  return Math.max(...colYs) - y;
}

function wrapCanvasText(ctx, text, width, lineHeight, force = false, font = ctx.font) {
  ctx.font = font;
  return { lines: wrapLines(ctx, text, width, force), height: wrapLines(ctx, text, width, force).length * lineHeight };
}

function drawWrappedCanvasText(ctx, text, x, y, width, lineHeight, options = {}) {
  if (options.font) ctx.font = options.font;
  const lines = wrapLines(ctx, text, width, true);
  let cy = y;
  for (const lineText of lines) {
    ctx.fillText(lineText, x, cy);
    cy += lineHeight;
  }
  return lines.length * lineHeight;
}

function wrapLines(ctx, text, width) {
  const chars = Array.from(cleanText(text));
  const lines = [];
  let lineText = "";
  for (const char of chars) {
    const test = lineText + char;
    if (lineText && ctx.measureText(test).width > width) {
      lines.push(lineText);
      lineText = char.trimStart();
    } else {
      lineText = test;
    }
  }
  if (lineText) lines.push(lineText);
  return lines;
}

function drawDoubleRule(ctx, x1, y, x2) {
  ctx.strokeStyle = "rgba(38,29,20,0.62)";
  ctx.lineWidth = 1;
  line(ctx, x1, y, x2, y);
  line(ctx, x1, y + 6, x2, y + 6);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function findGame(gameId) {
  return state.manifest.games.find((game) => game.id === gameId) || state.manifest.games[0];
}

function issueLabel(issue) {
  const turn = issue.turn == null ? "" : `T${String(issue.turn).padStart(3, "0")}`;
  return [turn, issue.dateline || issue.year].filter(Boolean).join(" / ");
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("game", state.gameId);
  url.searchParams.set("issue", state.issueId);
  history.replaceState(null, "", url);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

function el(tagName, attrs = {}, ...children) {
  const node = document.createElement(tagName);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
