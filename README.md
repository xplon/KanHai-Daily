# 看海日报

这是一个基于 Unciv 联机存档的娱乐向报纸生成项目。程序只负责只读获取存档、清洗信息、做低泄密风险的局势摘要；真正的文章由 LLM 写。

## 当前工作流

1. 从 `https://uncivserver.xyz/files/{gameId}` 只读下载完整 `GameInfo`。
2. 解码 Unciv 的 gzip/base64 存档格式。
3. 抽取并脱敏成当期目录里的 `brief.json`。
4. 生成 `source-pack.json`，其中 `brief` 字段就是 LLM 能看到的完整信息源。
5. 组装最终写稿提示词到 `ai-prompt.md`。
6. 同步生成内部核稿用的 `evidence.md`，记录真实看海信息与脱敏素材的对应关系。
7. 更新累计时间线 `reports/timeline.json` 和 `reports/timeline.md`。
8. 调用 Anthropic 兼容接口生成 `paper.md`，随后生成 `fact-check.md` 做 LLM 二次核验。

默认不会上传或修改联机存档。

## 配置

`.env` 放在 `kanghai-daily/.env`，这个文件已加入 `.gitignore`。示例见 `kanghai-daily/.env.example`。

必需：

```env
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
ANTHROPIC_MODEL=
```

可选：

```env
KANGHAI_TEMPERATURE=0.75
KANGHAI_MAX_TOKENS=1800
```

## 生成报纸

```powershell
node .\kanghai-daily\scripts\kanghai-paper.mjs `
  --game-id 2ec21879-b28b-4ea4-89f8-aafb87d6e532 `
  --server https://uncivserver.xyz
```

默认输出到类似这样的当期目录，避免覆盖旧报纸：

```text
kanghai-daily/reports/runs/T081_公元230年_20260513-195733/
```

当期目录内会包含：

- `paper.md`: 可发群的看海日报。
- `fact-check.md`: LLM 对成稿做的事实核验。
- `brief.json`: 程序整理出的脱敏素材。
- `source-pack.json`: LLM 可见信息源集中版。
- `ai-prompt.md`: 实际发送给 LLM 的完整提示词。
- `evidence.md`: 内部信源核对稿。
- `llm-response.json`: 写稿模型调用元信息。
- `fact-check-response.json`: 核验模型调用元信息。

只生成脱敏素材和提示词，不调用 LLM：

```powershell
node .\kanghai-daily\scripts\kanghai-paper.mjs --no-llm
```

指定写作倾向：

```powershell
node .\kanghai-daily\scripts\kanghai-paper.mjs --style 悼文
node .\kanghai-daily\scripts\kanghai-paper.mjs --style 文言
node .\kanghai-daily\scripts\kanghai-paper.mjs --style 独家消息
```

## 栏目设计

脚本会把这些栏目作为选项交给 LLM，LLM 每期自行选择合适的 2-4 个：

- 头版社论
- 战地通讯
- 独家密电
- 政治观察
- 经济风向
- 文化副刊
- 科学与奇观
- 讣告与悼文
- 史馆档案
- 市井版

“独家密电”允许轻微涉密，但只能写趋势、传闻、隐喻和专家口吻，不能写成战术简报。

版面不会固定套模板。脚本会把版面约束写进 brief：每期栏目之间尽量主题正交，不要所有栏目都围绕同一个国家或同一件事；`讣告与悼文` 是罕见强触发栏目，只有失城、首都陷落、亡国边缘或局势强烈支持时才建议使用。

## 泄密边界

公开稿禁止出现：

- 玩家 UUID、游戏 ID、服务器和 API 信息。
- 坐标、路线、精确兵力、单位部署、城市防御细节。
- 精确金币、科研、文化、产能、科技清单、建造队列。
- 能直接指导玩家决策的内容。

公开稿允许出现：

- 公元纪年，例如当前 T81 会被转成 `公元230年`。
- 文明名、公开广播、宽泛局势判断。
- “高位”“低迷”“军势醒目”“边境不宁”“商路活跃”这类模糊描述。
- 完全娱乐化的报纸梗、悼文、诗歌、广告、读者来信等。

## 信源核对稿

每次运行 `kanghai-paper.mjs` 都会在当期目录内额外生成 `evidence.md`。这份文件用于人工核稿，不建议发群。

它会展示：

- 当前存档来源、Unciv 版本、规则、速度、模组和纪年换算。
- LLM 可见 source pack 的位置、字段数量和摘要。
- 文明指标的原始数值，以及这些数值如何变成“高位”“低迷”“军势醒目”等 brief 标签。
- 政治概览里的正式宣战、友好宣言和城邦保护关系；正式宣战会附带存档外交状态、`DeclaredWarOnUs` 等可追溯依据，友好关系不会被当作和平保证。
- 公开战争、贸易传闻和近期通知的真实文本。
- 夺城与城市易手台账，例如城市原属、现属、发生时间和城市量级。
- 战区态势核对，例如交战/对峙双方、总体军势比例带、产能比例带、前线兵影比例带和地形趋势。
- 每条真实通知进入 brief 前的降敏写法。
- 脱敏地图趋势，例如某文明周边是否出现他国兵影、蛮族压力或外向兵影。
- 近期军备、科研、文化、财政、产能趋势的脱敏判断。
- 已完成奇观、自然奇观、宗教旗号、圣城素材和政策取向；这些可用于文化副刊和政治观察，但不会暴露当前建造队列。
- `sourceClaims` 列表，用来核对报纸里的具体事实是否有来源。
- “独家密电”专家素材主要依据哪些看海信息。

也可以指定输出位置：

```powershell
node .\kanghai-daily\scripts\kanghai-paper.mjs --evidence-out .\kanghai-daily\reports\evidence.md
```

## 累计时间线

`reports/timeline.json` 是长期大事记，脚本每次运行会追加新事件并按 key 去重。它只保留足以改变局势或值得复盘的大事件，例如城市易手、时代变化、奇观建成、宗教强化等。

`reports/timeline.md` 是从长期库生成的阅读版，适合之后回顾战争、奇观和时代变化。普通边境提示、城市涨人口、零散蛮族消息不会进入这里。

```powershell
node .\kanghai-daily\scripts\kanghai-paper.mjs --no-llm --no-timeline
```

可以用 `--no-timeline` 临时跳过时间线更新。

## 后台分析线

`scripts/kanghai-daily.mjs` 是旧的后台分析脚本，会输出更像数据简报的 `reports/latest.md`。它适合调试，不建议直接发群。

```powershell
node .\kanghai-daily\scripts\kanghai-daily.mjs --out .\kanghai-daily\reports\latest.md
```

## 关键代码来源

- `Unciv/core/src/com/unciv/logic/multiplayer/storage/MultiplayerServer.kt`: 下载完整存档和预览。
- `Unciv/core/src/com/unciv/logic/files/UncivFiles.kt`: 存档 JSON 与 gzip/base64 编解码入口。
- `Unciv/core/src/com/unciv/ui/screens/savescreens/Gzip.kt`: gzip/base64 实现。
- `Unciv/server/src/com/unciv/app/server/UncivServer.kt`: `/files/{fileName}` 只读/上传路由。
- `Unciv/core/src/com/unciv/models/ruleset/Speed.kt`: 回合转纪年逻辑。
