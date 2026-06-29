# Tianlu (Zairen) Zhu 工作更新日志

本文记录从 Yang 的最后一次主线提交之后，本分支中由 Tianlu (Zairen) Zhu 推进的工作。

基线提交:

- `92b585e`，作者 `yang-29`，日期 `2026-05-13`
- 提交说明: `README: link to mechanize-work/gba-eval-attempts for the May 2026 model outputs.`

当前工作分支:

- `version6-frontend-rewrite`
- 功能实现截至提交: `69ffa31 Add Replay 2 offset search viewer`
- 主要时间范围: `2026-06-23` 到 `2026-06-29`

## 简短结论

这条工作线把 GBA Eval 的视频差异分析从“逐帧像素差异”推进到了“时间位移诊断”。核心成果是: 对 reference 和 candidate 的帧序列，在前后若干帧内搜索最匹配的时间偏移，识别 candidate 是否只是整体晚了或早了几帧，或者是否只有局部元素存在不同的时间偏移。

目前已经在合成样例和两个真实 replay 样例上验证。两个真实样例都能检测出 `+4` 帧的最佳偏移，其中 replay1 还显示存在局部混合时间偏移。

## 主要工作线

### 1. 建立帧序列比较工具

新增了 `synthetic_compare`，用于比较两个目录下的 `240 x 160` PNG 帧序列。

这个工具的目标是把视频比较从浏览器 UI 或 emulator 内部逻辑中拆出来，变成一个可以独立跑、可以写测试、可以重复验证的后端命令。

主要能力:

- 输入 `reference/` 和 `candidate/` 两组帧。
- 使用和 GBA Eval 视频评分一致的帧级比较口径。
- 输出严格逐帧比较结果，包括 `video_score`、`histogram`、`frame_diff_threshold` 等。
- 支持 `--summary-only`，方便前端或日志只读取 compact 结果。

相关目录:

- `harness/lockstep/src/bin/synthetic_compare.rs`
- `harness/lockstep/src/synthetic_compare.rs`
- `harness/lockstep/tests/synthetic_compare.rs`
- `harness/lockstep/SYNTHETIC_COMPARE.md`

### 2. 加入时间位移搜索算法

在帧比较工具中加入 `--temporal-window N`，用于搜索 candidate 相对 reference 在 `[-N, N]` 范围内的最佳时间偏移。

当前最常用配置是:

```sh
--temporal-window 5
```

也就是在前后五帧内搜索。这个范围足够覆盖我们目前看到的 `+4` 帧问题，同时不会把搜索范围放得过宽。

新增输出包括:

- `classification`: 把结果归类为 `matching`、`global_time_shift`、`mixed_local_time_shifts`、`visual_mismatch` 等。
- `global_best_offset`: 全局最佳帧偏移。
- `global_improvement`: 应用最佳偏移后，整体缺陷改善多少。
- `global.offset_defects`: 每个候选偏移对应的缺陷值，可用于画柱状图。
- `tiles`: 每个 `10 x 10` tile 的局部时间偏移估计。
- `regions`: 把相邻且偏移一致的 tile 合并为区域。
- `local_offsets`: 按偏移量汇总的局部区域信息，包括位置标签、区域数量、tile 数、置信度等。

这一步的意义是让评测结果不只说“画面不一样”，而是能进一步说明“不一样可能是因为某些元素早了或晚了几帧”。

### 3. 合成样例验证

为了确认算法不是只在真实复杂样例上碰巧有效，我加入了可控的合成 demo。

#### Menu snow demo

构造一个静态菜单背景和会移动的雪花粒子，让 candidate 的动态部分延迟若干帧。

目的:

- 验证静态区域不会被误判为时间偏移。
- 验证动态雪花区域可以被识别出延迟。

相关提交:

- `6a1330a Add synthetic menu snow demo`

#### Mixed timing demo

构造一个更强的合成样例: 背景同步移动，但两个不同区域存在不同时间错误。

例子:

- 右上区域粒子延迟 `5` 帧。
- 右下区域粒子提前 `4` 帧。

目的:

- 验证算法不仅能识别整体偏移，也能识别局部混合偏移。
- 验证区域合并、位置标签、分类结果都能工作。

相关提交:

- `eea1c76 Add mixed timing synthetic demo`
- `dd22cc8 Flag mixed local temporal offsets`
- `08761b3 Classify temporal comparison summaries`

相关目录:

- `results/mixed-timing-demo-verify/`
- `web-play-analysis/flexible-comparator-ui/demo/mixed/`

### 4. 可视化时间位移结果

在算法结果之外，加入了可视化辅助:

- `temporal-heatmap.png`: 用颜色展示每个区域估计出的时间偏移。
- `temporal-region-overlay.png`: 在原始画面上画出时间偏移区域。
- flexible comparator UI: 用网页方式对比 reference、candidate、difference，并展示 offset 搜索结果。

后来针对 replay 页面，用户明确希望去掉 heatmap 和 region overlay，把重点放到:

- 左右帧对比。
- difference 区域。
- offset 搜索柱状图。
- 框选局部差异后查看局部对比。

这形成了后续 replay1-viewer 和 replay2-viewer 的 UI 方向。

### 5. 抓取和整理 GBA Eval Play 页面资源

为了让真实样例可以离线复现，加入了 `web-play-analysis/`。

这里保存了 public `/play` 页面的运行入口、前端 chunk、leaderboard 数据、ROM/WASM 资源，以及候选模型的 WASM 文件。

关键结论:

- live reference/candidate 不是预录视频，而是在浏览器里运行 emulator。
- reference 使用 Mesen WASM。
- candidate 使用模型生成的 emulator WASM。
- 两边加载同一个 GBA ROM，再用相同输入推进。
- 可比较的可靠数据源是 canvas 内部 `240 x 160` 像素，而不是屏幕截图。

相关目录:

- `web-play-analysis/`
- `web-play-analysis/live-assets/`
- `web-play-analysis/local-play-mirror/`

### 6. 建立 verified 的 flexible comparator 前端

在 `e1e5833 Add version 6 flexible comparator UI` 中，恢复并固定了一个用户验证过可用的 flexible comparator UI。

这个版本后来被标记为:

- `verified/version6-frontend`

它的价值是提供一个稳定前端基线:

- 可以比较 candidate 和 standard/reference。
- 可以展示 difference。
- 可以看到 offset 搜索结果。
- 可以作为后续 replay UI 的样式和交互基础。

相关目录:

- `web-play-analysis/flexible-comparator-ui/`

### 7. 建立 replay 帧素材生成流程

为了从真实 replay 文件中生成可比较素材，新增了 replay frame capture 流程。

这个流程做的事情:

- 读取 `.replay` 文件。
- 用同一份 ROM、reference WASM、candidate WASM 回放。
- 保存 reference 帧、candidate 帧、diff 帧。
- 生成 `recording.json`，记录帧范围和素材元数据。
- 生成 `comparator-summary.json`，保存后端比较和时间位移分析结果。
- 支持 `--last N`，可以只保存 replay 的最后 N 帧。

相关目录:

- `web-play-analysis/replay-frame-capture/`
- `web-play-analysis/replay-frame-capture/replays/`
- `web-play-analysis/replay-frame-capture/generated/`

### 8. Replay 1 真实样例

Replay 1 使用 Claude Opus 4.8 的真实 replay 场景，保存前 60 帧。

素材位置:

- `web-play-analysis/replay-frame-capture/replays/replay1.replay`
- `web-play-analysis/replay-frame-capture/generated/replay1/`

保存内容:

- `reference/frame_0000.png` 到 `reference/frame_0059.png`
- `candidate/frame_0000.png` 到 `candidate/frame_0059.png`
- `diff/frame_0000.png` 到 `diff/frame_0059.png`
- `recording.json`
- `comparator-summary.json`

后端检测结果:

- `compared_frames`: `60`
- `classification`: `mixed_local_time_shifts`
- `global_best_offset`: `4`
- `has_mixed_local_offsets`: `true`
- 主要局部 offset:
  - 大部分画面为 `+4`。
  - 顶部一小条区域为 `+3`。
- `first_diverge_frame`: `2`
- `max_diff_pixels`: `38400`

这个样例说明: 真实 replay 中的差异不是简单的当前帧像素错误，而是存在时间位移，并且局部区域可能不是完全一致的同一个 offset。

对应页面:

- `web-play-analysis/replay1-viewer/`

页面能力:

- 回放 replay1 保存下来的 reference/candidate/diff 帧。
- 展示 offset 搜索柱状图。
- 自动显示最佳 offset 为 `+4`。
- 可框选 difference 区域查看局部对比。

### 9. Replay 2 真实样例

Replay 2 是第二个真实 replay 样例。原 replay 共 `702` 帧，本次只保存最后 `100` 帧，保留原始帧号 `602..701`。

素材位置:

- `web-play-analysis/replay-frame-capture/replays/replay2.replay`
- `web-play-analysis/replay-frame-capture/generated/replay2/`

说明文件:

- `web-play-analysis/replay-frame-capture/generated/replay2/README.md`

保存内容:

- `reference/frame_0602.png` 到 `reference/frame_0701.png`
- `candidate/frame_0602.png` 到 `candidate/frame_0701.png`
- `diff/frame_0602.png` 到 `diff/frame_0701.png`
- `recording.json`
- `comparator-summary.json`

后端检测结果:

- `compared_frames`: `100`
- `classification`: `global_time_shift`
- `global_best_offset`: `4`
- `global_best_defect`: `0.0`
- `has_mixed_local_offsets`: `false`
- `max_diff_pixels`: `349`

这个样例比 replay1 更干净: 应用 `+4` offset 后，全局缺陷可以降到 `0.0`，所以它是一个很好的“真实整体时间位移”证据样例。

对应页面:

- `web-play-analysis/replay2-viewer/`

页面能力:

- 回放 replay2 的原始帧号 `602..701`。
- 展示 offset 搜索柱状图。
- 自动显示最佳 offset 为 `+4`。
- 支持 difference 框选和局部对比。
- 使用独立服务端口，避免污染 replay1 或 synthetic flexible comparator。

### 10. 当前目录级修改概览

从 Yang 的 `92b585e` 到当前分支，主要新增和修改集中在:

- `harness/lockstep/`
  - 新增 synthetic frame comparison 后端。
  - 新增时间位移搜索、tile 分析、region 合并、分类输出。
  - 新增测试和说明文档。

- `results/mixed-timing-demo-verify/`
  - 保存合成 mixed timing demo 的验证页面和可视化输出。

- `web-play-analysis/`
  - 保存 public play 页面分析、静态资源、leaderboard、ROM/WASM 运行资产。
  - 保存 local play mirror。
  - 保存 flexible comparator UI。
  - 保存 replay capture 工具和 replay1/replay2 素材。
  - 保存 replay1/replay2 独立 viewer。

- `web-play-analysis/flexible-comparator-ui/`
  - 用户验证过的 version6 comparator UI。
  - 包含 synthetic mixed timing demo。

- `web-play-analysis/replay-frame-capture/`
  - replay 输入文件。
  - replay1/replay2 帧素材。
  - replay 素材生成脚本和测试。

- `web-play-analysis/replay1-viewer/`
  - replay1 的独立 UI。

- `web-play-analysis/replay2-viewer/`
  - replay2 的独立 UI。

## 关键提交时间线

从 Yang 的基线之后，核心提交如下:

```text
69ffa31 2026-06-29 Add Replay 2 offset search viewer
4a278a9 2026-06-29 Add Replay 2 final-frame assets
42f013f 2026-06-29 Add Replay 1 offset search viewer
8b30b51 2026-06-29 Align replay1 capture paths
654e029 2026-06-29 Add frames for replay1
a1c07a1 2026-06-29 Add Celeste Opus 4.8 replay comparison assets
e1e5833 2026-06-29 Add version 6 flexible comparator UI
e301e5f 2026-06-25 Enhance synthetic compare with moving diagonal background and add web-play-analysis
ac026dc 2026-06-24 Label local temporal offset locations
08761b3 2026-06-24 Classify temporal comparison summaries
dd22cc8 2026-06-24 Flag mixed local temporal offsets
8c4dc36 2026-06-24 Summarize local temporal offsets
eea1c76 2026-06-24 Add mixed timing synthetic demo
6a1330a 2026-06-24 Add synthetic menu snow demo
c5f9da4 2026-06-24 Add concise synthetic compare output
0ed04f4 2026-06-24 Add temporal analysis summary
1f9a6d0 2026-06-24 Add temporal region overlay output
adeda0c 2026-06-24 Group temporal offset tiles into regions
c579279 2026-06-24 Add temporal offset analysis for synthetic frames
fd78482 2026-06-23 Add synthetic frame sequence comparison tool
```

## 对后续评测的意义

这条工作线让 GBA Eval 后续可以给出更有解释力的反馈。

过去只看逐帧差异时，系统可能只能说 candidate 的画面和 reference 不一致。现在可以进一步回答:

- candidate 是否只是整体早了或晚了几帧。
- 最可能的全局 offset 是多少。
- 应用 offset 后差异是否大幅减少。
- 是否只有某些局部元素存在时间偏移。
- 这些局部元素大概位于画面的哪个区域。

这对 BET 或后续 benchmark feedback 很有用。它可以把模型反馈从“画面错了”推进到更具体的诊断，例如“雪花/粒子/某些运动元素相对 reference 晚了约 4 帧”，从而帮助模型或开发者定位 emulator 时间推进、输入处理、渲染同步等问题。

## 当前可复用资产

可复用的后端能力:

- 帧目录比较。
- 前后五帧时间偏移搜索。
- 全局 offset 分类。
- 局部 offset 分析。
- 区域聚合和位置标签。

可复用的真实素材:

- replay1: 前 60 帧，真实 mixed local time shifts 样例。
- replay2: 最后 100 帧，真实 global time shift 样例。

可复用的 UI:

- version6 flexible comparator: 用户验证过的稳定基线。
- replay1-viewer: replay1 专用。
- replay2-viewer: replay2 专用。

## 下一步建议

后续可以继续做:

- 加入 replay3、replay4 等更多真实样例。
- 把 replay viewer 抽成通用 viewer，通过配置选择 replay 数据集。
- 把 `global_best_offset`、`local_offsets`、`top_regions` 接入正式评测报告。
- 把“前后五帧搜索”作为视频评分旁边的诊断项，而不是替代原始分数。
- 为 BET 生成更自然的反馈文本，例如“主要运动区域相对 reference 延迟约 4 帧”。
