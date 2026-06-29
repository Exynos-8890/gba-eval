# Tianlu 工作简短汇报

从 Yang 上一次主线更新之后，我主要推进了 GBA Eval 的视频差异诊断能力。核心发现是: 一些 candidate 和 reference 的差异不是单纯的像素错误，而是真实存在“帧位移”。也就是说，画面内容本身可能是对的，但某些运动元素或者整个 candidate 相对 reference 早了或晚了几帧。

围绕这个问题，我先实现了一个帧位移搜索算法: 对 reference 和 candidate 的帧序列，在前后五帧范围内寻找差异最小的匹配，并输出最佳 offset、改善幅度、整体/局部分类，以及哪些画面区域存在时间偏移。这个算法可以区分全局时间位移和局部混合时间位移。

我先用合成雪花和 mixed timing demo 验证算法，确认它能识别“雪花延迟几帧”以及“不同区域有不同 offset”这类情况。之后又整理了两个真实 replay 样例，把 reference、candidate、diff 帧都保存进仓库，并建立了独立可视化页面。两个真实样例都检测出了 `+4` 帧位移: replay1 是 mixed local time shifts，replay2 是更干净的 global time shift，并且 replay2 在应用 `+4` offset 后全局差异可以降到 `0.0`。

这项工作的意义是，后续 BET 或评测报告可以给模型更具体的反馈，而不只是说“画面不同”。我们可以进一步指出: 这里可能是某些元素发生了时间偏移，偏移大约是几帧，出现在画面的哪个区域。这会让反馈更接近真实 bug，也更有助于后续定位 emulator 的时间推进、输入同步或渲染同步问题。

当前已经保存下来的主要成果:

- 后端帧比较和前后五帧 offset 搜索算法。
- synthetic snow / mixed timing 验证样例。
- 用户验证过的 version6 flexible comparator UI。
- replay1 和 replay2 两套真实 replay 帧素材。
- replay1-viewer 和 replay2-viewer 两个独立可视化页面。
