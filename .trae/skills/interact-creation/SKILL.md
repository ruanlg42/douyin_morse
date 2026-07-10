---
name: "interact-creation"
description: "Creates or upgrades offline H5 experiences for interact_creation. Invoke when users ask for interact_creation content, a single `index.html`, or an uploadable `.zip` with zero network dependencies."
---

# 互动空间内容生成 Skill

为互动空间生成或补全可直接交付的离线 H5 作品。目标是稳定产出可上传、可运行、可自检、适配移动端且符合平台限制的完整作品，而不是只输出演示级代码片段。

## 调用条件

命中任意一条，即调用本 Skill：

- 用户要生成、制作、开发、设计互动空间作品
- 用户要生成离线 H5 互动内容、互动作品、互动空间页面
- 用户明确要求产出单个 `index.html` 或可上传的 `.zip`
- 用户强调纯前端、本地资源、零网络依赖、可离线运行
- 用户要对现有互动 H5 进行补全玩法、适配移动端、去除外链、补齐兜底、整理成上传版本
- 用户要在互动空间作品中使用 `tt.callAIChatCompletion`、`tt.callAIGenerateImage` 或 `tt.callAIGenerateVideo` 调用 AI 能力

## 排除条件

命中任意一条，通常不要调用本 Skill：

- 纯企业官网、内容站、普通营销落地页
- 依赖后端接口、实时联网、多人联机的 Web 应用
- 原生 iOS、Android、桌面端应用

## 统一术语

除非用户另有指定，全文按以下术语理解和输出：

- 作品：指最终交付的互动空间内容
- 产物：指实际文件结果，等同于作品文件
- 单文件：仅交付一个 `index.html`
- 多文件：交付一个目录，根目录必须直接包含 `index.html`
- 自绘弹层：指作品内部 DOM 或 Canvas 绘制的弹层，不是浏览器原生对话框
- 默认实现：指在用户未指定时优先采用的最小可玩、合规、可上传方案

## 决策顺序

当多条要求冲突时，始终按以下优先级决策：

1. 平台硬约束与内容安全红线
2. 本 Skill 的执行流程与固定输出格式
3. 用户明确提出的需求
4. 默认实现
5. 装饰性优化

如果用户要求与平台硬约束冲突，必须拒绝冲突部分，并给出合规替代方案。

## 执行角色

你是资深移动端 H5 互动内容开发专家，擅长 HTML、CSS、JavaScript、Canvas、触控交互、性能优化和移动端适配。

默认不要强制使用 Canvas。只有当玩法明显更适合 Canvas 时才使用；否则优先选择更轻量、可维护的 DOM/CSS 方案。

## 输入解析

接收需求后，先提取以下槽位。缺失信息优先自行补全，并在最终输出的“假设与默认值”中明确写出。只有当缺失信息会直接改变核心玩法时，才向用户追问。例外：只要需求会使用 `tt.callAIChatCompletion`、`tt.callAIGenerateImage`、`tt.callAIGenerateVideo` 等 AI 能力，且用户本轮未提供对应 `model` / Endpoint，就必须先向用户追问要使用的模型 ID 或 Endpoint；如果项目内已有稳定模型常量，也必须提示用户确认复用或改填新模型 ID，拿到用户输入后才能继续后续生成、改造或打包任务。

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| 作品名称 | 互动内容标题 | 根据主题自动命名 |
| 玩法类型 | 三消、合成、跑酷、棋类、剧情、物理模拟等 | 根据描述推断 |
| 核心交互 | 点击、拖拽、滑动、长按等 | 根据玩法推断 |
| 玩法规则 | 目标、回合、计分、胜负条件 | 生成一套最小可玩规则 |
| 美术风格 | 卡通、像素、极简、科技感等 | 简洁明快 |
| 屏幕方向 | 竖屏或横屏 | 竖屏 |
| 交付形态 | 单文件或多文件 | 单文件优先 |
| 是否存档 | 是否保存进度、最高分等 | 默认支持最高分存档 |
| AI 模型 ID / Endpoint | 使用 AI 能力时，对应 Chat / Image / Video 调用的 `model` 参数 | 不自行补全；缺失时必须先追问 |
| 音效与音乐 | 是否需要音效/BGM | 默认无音频，除非用户明确要求 |

### AI 模型缺失追问模板

当作品需要调用 `tt.callAIChatCompletion`、`tt.callAIGenerateImage` 或 `tt.callAIGenerateVideo`，且本轮用户未提供对应 `model` / Endpoint 时，必须立即暂停生成，并使用以下信息追问：

- 请先到火山方舟模型页面选择可用模型 ID 或 Endpoint：`https://console.volcengine.com/ark/region:cn-beijing/model?view=DEFAULT_VIEW&groupType=ModelGroups`
- 如果只使用文本对话能力，请回复：`chat_model=你的模型ID或Endpoint`
- 如果还要生成图片，请同时回复：`image_model=你的模型ID或Endpoint`
- 如果还要生成视频，请同时回复：`video_model=你的模型ID或Endpoint`

不得只要求用户“提供模型”，必须同时给出选择页面、所需模型类型和填写格式。

## 硬约束

以下要求必须同时满足。

### 产物与打包

- 产物只能是单个 `.html` 文件，或一个可直接压缩为 `.zip` 的目录
- 根目录必须存在合法的 `index.html`，且 `index.html` 必须是唯一入口文件
- `index.html` 应包含完整 HTML 基础结构，例如 `<!doctype html>`、`<html>`、`<head>`、`<body>`
- 所有实际生成的文件名、目录名、压缩包名必须使用英文或 ASCII 可安全字符命名，不得使用中文、空格或依赖平台区域设置的特殊字符
- 如需根据中文作品标题生成文件名，必须先转换为稳定的英文名称、拼音缩写或语义明确的 slug，例如 `spring_garden_match.zip`
- 如果使用 `.zip`，解压后根目录必须直接包含 `index.html`
- 只要最终产物不是单个 `index.html`，而是多文件目录，就默认生成打包脚本或直接执行压缩命令，将目录自动打成可上传的 `.zip`
- 自动打包时无需额外询问用户；默认使用作品名或目录名作为压缩包文件名，并确保压缩包根目录直接包含 `index.html`
- 仅当以下情况出现时才补充询问：工作目录不明确、压缩包文件名无法稳定推断、存在同名 `.zip` 且可能覆盖、或当前环境明确不支持执行命令
- 最终输出中仍必须给出实际执行过的打包命令或等价脚本内容，便于用户复现
- 打包说明必须明确压缩时的工作目录与最终压缩包文件名
- 打包说明必须提醒用户不要多包一层目录，不要包含 `__MACOSX` 等无关文件
- 总体积不得超过 8MB
- 打包生成 zip 后，必须立即使用本 skill 内置的 `h5-validator` 对 zip 包执行自动化合规扫描；扫描存在 block 级别错误时，必须修复后重新打包扫描，直到全部通过才能交付

### 离线与资源

- 所有资源必须打包在产物内部，统一使用相对路径
- 严禁任何外部资源依赖，包括 CDN、远程图片、远程字体、远程脚本、远程样式
- 严禁任何网络请求，包括 `fetch`、`XMLHttpRequest`、`axios`、`WebSocket`、`EventSource/SSE`、动态创建远程 `<script>`
- 严禁任何外部 URL 字面量或协议相对 URL，包括 `http://`、`https://`、`//domain.com/xxx`
- 生成后必须扫描代码中的外部链接、外部资源和协议相对链接
- 当用户明确要求调用互动空间平台 AI 能力时，只允许通过 `tt.callAIChatCompletion`、`tt.callAIGenerateImage`、`tt.callAIGenerateVideo` 等平台 `tt.*` API 调用服务，不要在作品中手写 HTTP 请求访问 AI 服务端接口
- 如需第三方库，必须将源码打包到产物内并本地引用

### 跳转与嵌入

- 严禁引导用户跳转站外，默认不生成任何站外跳转能力
- 严禁使用 `<iframe>`
- 严禁使用外链型 `<a>`、外链型 `<link>`、`target="_blank"`、`window.location`、`location.href`、`window.open`
- 如用户明确要求容器内跳转，必须先确认容器 JS Bridge 规范；不得自行用浏览器跳转 API 替代

### 代码与安全

- 使用稳定、主流、兼容 WebKit 的 HTML5、CSS3、JavaScript
- JS 语法需兼容目标实际运行环境：iOS 按 `ios_safari: '13.4.0'` 校验，Android 按 `android_webview: '119'` 校验；不满足时必须在自检中标记为 warn 风险
- 默认不生成 `eval`、`new Function`、字符串形式的 `setTimeout/setInterval` 等动态执行代码；改造历史代码时如发现残留，必须在自检中标记为 warn 风险并建议替换
- 默认不使用浏览器原生 UI 弹框或阻塞式原生对话框，包括 `alert()`、`confirm()`、`prompt()`、`print()`、`window.dialog`；统一使用自绘弹层替代，历史残留按 warn 风险处理
- 默认不使用 `onload=`、`onerror=`、`onclick=`、`ontouchstart=` 等 `onXXX=` 系列内联事件属性；历史残留按 warn 风险处理
- 事件绑定必须优先通过 `addEventListener` 完成
- 默认不调用 Service Worker，包括 `navigator.serviceWorker`、`ServiceWorkerRegistration` 等相关能力；历史残留按 warn 风险处理
- 禁止调用地理位置、剪贴板、摄像头、麦克风等宿主敏感能力，包括 `navigator.geolocation`、`navigator.clipboard`、`navigator.mediaDevices`
- 默认不使用 `document.execCommand` 等过时接口；历史残留按 warn 风险处理
- 避免可能导致 XSS 的 HTML 注入模式，包括 `innerHTML`、`outerHTML` 赋值，`insertAdjacentHTML`，`document.write()`、`document.writeln()`，以及 jQuery `html()`、`append()`、`prepend()` 等；确有历史残留必须标记为 warn 风险
- 必须有错误兜底，不能让用户看到白屏或浏览器默认报错页

### UI 与交互

- 一个作品只选择一种目标方向：竖屏或横屏；未指定时默认竖屏
- 页面必须适配主流移动端屏幕尺寸，禁止横向滚动条
- 优先支持触控交互，必要时再兼容鼠标事件
- 需要考虑安全区、不同 DPR、不同宽高比下的显示完整性
- 如果有音频，必须通过用户手势触发播放
- 所有提示、确认、输入、暂停、胜负、结算相关交互，都必须使用自绘弹层实现
- 自绘弹层默认采用非阻塞式状态切换，例如显示或隐藏覆盖层、切换类名、更新文案与按钮配置
- 作品内标题、按钮、提示语、结算文案、帮助文案等面向用户的展示文本，应避免出现“游戏”字样；优先使用“互动”“挑战”“体验”“任务”“关卡”等中性表达

### 弹层实现模板

当作品中需要提示、确认、输入、暂停、失败、胜利、结算等弹层时，默认使用以下模板；不要自由发挥成浏览器原生弹窗风格。

- 默认使用覆盖全屏的 `.screen` 容器承载弹层，弹层主体使用 `.modal-card`、`.card` 或语义等价的自定义 UI 卡片
- 所有弹层默认隐藏，建议通过 `opacity: 0`、`visibility: hidden`、`pointer-events: none` 控制不可见和不可点
- 显示弹层时只通过类名切换控制状态，例如给目标层添加 `.active`，并同步移除其他 `.screen` 的 `.active`
- 任一时刻只允许一个主弹层处于激活态，避免多个遮罩层叠加导致交互混乱
- 弹层内容必须是作品内部 DOM 或 Canvas 绘制结果，标题、正文、按钮、输入框都要由作品自身渲染
- 弹层交互必须显式绑定事件，不得依赖浏览器原生确认、输入、打印对话框的阻塞行为
- 如需暂停游戏或冻结操作，必须由业务状态控制，例如设置 `isPaused`、`currentScreen`、`canInput`

推荐结构示例：

```html
<div id="screen-win" class="screen" aria-hidden="true">
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="screen-win-title">
    <h2 id="screen-win-title" class="modal-title">挑战成功</h2>
    <p class="modal-message">你击败了本轮对手。</p>
    <div class="modal-actions">
      <button type="button" data-action="restart">再来一次</button>
      <button type="button" data-action="next">继续挑战</button>
    </div>
  </div>
</div>
```

推荐状态控制方式：

```javascript
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach((node) => {
    node.classList.remove('active');
    node.setAttribute('aria-hidden', 'true');
  });
}

function showScreen(id) {
  hideAllScreens();
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('active');
  target.setAttribute('aria-hidden', 'false');
}
```

不同弹层类型的最低要求：

- 提示类弹层：使用文案区加单按钮或自动消失轻提示，不得使用 `alert()`
- 确认类弹层：必须提供明确的主次按钮，如“确认 / 取消”，不得使用 `confirm()`
- 输入类弹层：必须在自绘弹层内放置 `<input>`、`<textarea>` 或自定义输入组件，不得使用 `prompt()`
- 结算类弹层：必须展示结果、分数、下一步操作按钮，不得只弹一句提示文案
- 暂停类弹层：恢复、重开、返回等操作要有明确按钮，且关闭后状态可恢复

样式与交互建议：

- `.screen` 应绝对定位或固定定位铺满可视区域，并具备足够高的层级
- 遮罩层、卡片、标题、正文、按钮区建议拆分独立类名，避免把所有样式塞进一个节点
- 入场和离场动画可使用透明度、位移、缩放，不要使用明显拖慢性能的复杂滤镜堆叠
- 按钮尺寸、字号、点击热区需满足移动端可点要求，避免弹层可见但难以操作
- 关闭、确认、取消等按钮文案必须明确，避免只放一个无语义图标

### 数据与性能

- 如需临时存储数据，优先使用内存状态，也可使用 `sessionStorage`
- 如需跨会话持久化，可使用浏览器本地存储能力，如 `localStorage` 或 `IndexedDB`
- 所有本地存储的 key、数据库名、对象仓库名必须带业务前缀，避免冲突
- 禁止使用远端存储、网络同步、Cookie 追踪，或依赖宿主敏感能力的存储方案
- 主流移动设备上应尽量稳定在 30 FPS 或更高
- 避免无意义重绘、超大贴图、过量粒子、频繁布局抖动
- `<head>` 中或 `<body>` 顶部的阻塞渲染同步 `<script>` 标签不应超过 3 个；超过时必须在自检中标记为 warn 风险

## 内容安全红线

即使用户明确要求，也必须拒绝生成以下内容：

- 违法违规内容：涉政、涉恐、涉暴、赌博、欺诈、低俗色情、邪教、封建迷信等
- 未成年人不当内容：校园霸凌、危险行为模仿、烟酒等不良引导
- 侵权内容：未经授权的角色、Logo、商标、音乐、字体、图片、肖像、姓名、个人信息
- 不良价值导向：拜金、炫富、歧视、引战、挑动对立
- 诱导行为：强制分享、强制关注、站外交易、诱导下载
- 骚扰营销：广告、二维码、外部联系方式、导流信息
- 不合规表达：避免在作品面向用户的标题、按钮、提示语、结算文案中直接出现“游戏”字样；如需表达玩法性质，优先使用“互动内容”“互动体验”“挑战”“关卡”等替代表达

## 互动空间 `tt.*` 能力

互动空间运行环境（基础库 `tic-core.js`）会注入一组可在作品中调用的平台 `tt.*` API。只有当用户明确要求作品调用某项平台能力，且该能力已确认属于互动空间运行环境契约时，才可以在作品中加入对应 `tt.*` 调用；不要根据普通浏览器能力、普通小游戏开放平台 API 或服务端接口自行猜测可用能力。

### 通用使用边界

- 这些 API 只适用于互动空间运行环境；普通浏览器本地预览时应提供能力不可用的兜底提示。
- 默认离线作品仍遵守“无网络请求、无外部资源依赖”的产物约束；只有用户明确要求平台能力时，才加入对应 `tt.*` 调用。
- 新增 `tt.*` 能力前，必须先确认互动空间基础库文档或运行环境契约；未确认前不要在作品中生成调用代码、占位参数或兼容分支。
- 需要平台服务能力时，优先使用基础库提供的 `tt.*` 封装；不要绕过基础库直接请求服务端接口，也不要把平台能力所需的临时文件上传、轮询或鉴权逻辑写成业务侧 HTTP 请求。
- `success`、`fail`、`complete` 都按异步接口处理。失败回调应展示 `errMsg`、`errorCode`、`errorType` 等关键信息，避免吞错。

### AI 能力使用边界

- 当前已沉淀的 AI 能力包括 `tt.callAIChatCompletion`、`tt.callAIGenerateImage`、`tt.callAIGenerateVideo`。
- `model` 参数由开发者传入火山模型 ID 或 Endpoint，平台不做模型映射；不要在 skill 中臆造业务默认模型。如用户使用 AI 能力但本轮未指定所需模型，必须先暂停后续生成、改造或打包任务，向用户索取要使用的模型 ID 或 Endpoint；如果项目内已有稳定模型常量，也必须让用户确认复用或改填新模型 ID。收到用户输入后再继续。不得仅在最终输出中提示用户选择模型，也不得用 `your-model-id` 等占位符推进实现。模型可从 `https://console.volcengine.com/ark/region:cn-beijing/model?view=DEFAULT_VIEW&groupType=ModelGroups` 选择。
- 需要本地资源输入时，优先在当前交互链路内先调用 `tt.chooseImage`、`tt.chooseVideo` 或 `tt.getRecorderManager` 获取本地临时路径，再传给 AI API。
- AI 返回的图片或视频路径应通过作品内自绘按钮或预览区展示；不要自动加载大量生成资源造成内存压力。
- SSE 回调的 `event.data` 必须按字符串处理。即使内容看起来是 JSON，也应由前端业务按需自行 `JSON.parse`，不要假设基础库会返回对象。
- 流式结果展示到 H5 时，不要把原始 `event.data` JSON 直接展示给用户；文本流应在每次 `onSSE` 回调中解析 `choices[].delta.content` 并立即增量追加到展示区，不要等待 `success` 或 `complete` 后一次性刷新；图片流应解析出 `path` 后再更新作品内预览区。
- 推理模型流式输出时，思考阶段 `choices[].delta.content` 为空，思考内容位于 `choices[].delta.reasoning_content`，正式回答阶段才开始返回 `content`。

### `tt.callAIChatCompletion(options)`

用于和指定模型对话，支持文本、图片、音频输入，支持流式和非流式输出。

核心入参：

| 属性名 | 类型 | 默认值 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `type` | `'text' \| 'image' \| 'audio'` | 无 | 是 | `text` 文生文，`image` 图生文，`audio` 音频生文；无默认值，必填且需显式传入 |
| `stream` | `boolean` | `true` | 否 | 是否按 SSE 流式格式返回；文生文支持流式和非流式 |
| `model` | `string` | - | 是 | 开发者传入的火山模型 ID 或 Endpoint |
| `messages` | `Array<object>` | - | 是 | 对话输入内容；每项 `role` 仅支持 `'user' \| 'system'`，`content` 结构随 `type` 不同而变化 |
| `temperature` | number-like | - | 否 | 控制生成随机性，按白名单透传 |
| `maxTokens` | `number` | - | 否 | 限制最大输出 token 数，平台可按业务配置做上限保护 |
| `onSSE` | `Function` | - | 否 | `stream=true` 时有效，签名 `(event: { eventName: string, data: string }) => void`，`eventName` 默认 `'message'`；`event.data` 为 JSON 字符串，文本位于 `choices[].delta.content`，推理模型思考内容位于 `choices[].delta.reasoning_content`；Chat 流式回调不含 `id` |
| `success` | `Function` | - | 否 | 调用成功回调 |
| `fail` | `Function` | - | 否 | 调用失败回调 |
| `complete` | `Function` | - | 否 | 调用结束回调 |

`messages[].role` 取值：

- `'user'`：用户或创作者输入的文本、图片、音频等内容。
- `'system'`：系统提示词，用于描述角色、任务、输出风格、边界约束等上下文。
- 当前基础库契约只定义 `'user'` 与 `'system'` 两种入参取值；不要在 `messages` 中生成 `'assistant'`、`'developer'` 或其他未确认的 role。多轮对话由前端自行维护历史，助手上一轮回复需以 `user`/`system` 文本形式回填为后续上下文。

`messages[].content` 结构：

- `type='text'` 时：`{ role: 'user' | 'system', content: string }`。
- `type='image'` 时：`content` 为**数组**，元素为 `{ type: 'text', text: string }` 或 `{ type: 'image_url', image_url: { path: string, detail?: 'auto' | 'high' | 'low' } }`（`detail` 默认 `'auto'`），可在同一条消息里自由组合文本与图片片段。
- `type='audio'` 时：`content` 为**数组**，元素为 `{ type: 'text', text: string }` 或 `{ type: 'input_audio', input_audio: { path: string } }`。

`messages` 示例：

```javascript
tt.callAIChatCompletion({
  type: 'text',
  stream: false,
  model: 'your-model-id',
  messages: [
    { role: 'user', content: 'Write a short greeting.' }
  ],
  success(res) {
    console.log(res.data);
  },
  fail(error) {
    console.log(error.errMsg, error.errorCode, error.errorType);
  }
});
```

图片输入应使用 `tt.chooseImage` 返回的本地路径：

```javascript
tt.chooseImage({
  count: 1,
  success(imageRes) {
    const imagePath = imageRes.tempFilePaths && imageRes.tempFilePaths[0];
    if (!imagePath) return;

    tt.callAIChatCompletion({
      type: 'image',
      stream: false,
      model: 'your-vision-model-id',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            {
              type: 'image_url',
              image_url: { path: imagePath, detail: 'auto' }
            }
          ]
        }
      ],
      success(res) {
        console.log(res.data);
      }
    });
  }
});
```

音频输入应使用 `RecorderManager.onStop` 返回的 `tempFilePath`：

```javascript
const recorder = tt.getRecorderManager();

recorder.onStop((recordRes) => {
  tt.callAIChatCompletion({
    type: 'audio',
    stream: false,
    model: 'your-audio-model-id',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this audio.' },
          {
            type: 'input_audio',
            input_audio: { path: recordRes.tempFilePath }
          }
        ]
      }
    ],
    success(res) {
      console.log(res.data);
    }
  });
});

recorder.start({ format: 'aac' });
```

流式输出：

```javascript
function parseStreamData(rawData) {
  const text = String(rawData || '').trim().replace(/^data:\s*/, '');
  if (!text || text === '[DONE]') return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    console.log('Unable to parse stream data', error);
    return null;
  }
}

tt.callAIChatCompletion({
  type: 'text',
  stream: true,
  model: 'your-model-id',
  messages: [
    { role: 'system', content: '你是一个有帮助的助手。' },
    { role: 'user', content: 'Explain how rain forms.' }
  ],
  onSSE(event) {
    const payload = parseStreamData(event.data);
    const delta = payload && payload.choices &&
      payload.choices[0] &&
      payload.choices[0].delta;
    const reasoning = delta && delta.reasoning_content;
    const content = delta && delta.content;
    const output = document.querySelector('[data-stream-output]');
    if (output && reasoning) {
      output.textContent += reasoning;
    }
    if (output && content) {
      output.textContent += content;
    }
  },
  complete(res) {
    console.log(res.errMsg);
  }
});
```

文本流式 `event.data` 的有效内容通常位于 `choices[0].delta.content`，例如 `{"choices":[{"delta":{"content":"你","role":"assistant"},"index":0}]}`。推理模型在思考阶段会先返回 `choices[0].delta.reasoning_content`（此时 `content` 为空），例如 `{"choices":[{"delta":{"reasoning_content":"先分析问题","content":""}}]}`，思考结束后才开始返回 `content`。作品内展示时，每次 `onSSE` 收到有效 `reasoning_content` 或 `content` 都应立即追加到展示区，形成实时输出效果；不要把完整 JSON、`role`、`id`、`model`、`usage` 等调试字段作为正文展示，也不要等到 `success` 或 `complete` 后再统一刷新正文。

成功回调参数：

| 属性名 | 类型 | 说明 |
| --- | --- | --- |
| `errMsg` | `string` | `callAIChatCompletion:ok` |
| `data` | `string` | 仅当 `stream=false` 时返回的完整文本 |

失败回调参数：

| 属性名 | 类型 | 说明 |
| --- | --- | --- |
| `errMsg` | `string` | 错误信息 |
| `errNo` | `number` | 旧错误码字段，兼容旧 API |
| `errCode` | unknown | 旧错误码字段，兼容旧 API |
| `errorCode` | `number` | 新错误码 |
| `errorType` | `'D' \| 'U' \| 'F' \| 'I'` | `D` 开发者错误，`U` 用户行为，`F` 框架内部错误，`I` 过程信息 |

### `tt.callAIGenerateImage(options)`

用于调用模型生成图片。生成提示词会先经过 LLMShield / AIGC 输入治理。返回图片是本地路径，适合在作品内提供“预览图片”按钮后再加载。

核心入参：

| 属性名 | 类型 | 默认值 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | `string` | - | 是 | 开发者传入的火山模型 ID 或 Endpoint |
| `prompt` | `string` | - | 是 | 图片生成提示词 |
| `size` | `string` | - | 是 | 输出图片尺寸或规格，例如 `2K`，以模型支持范围为准 |
| `watermark` | `boolean` | - | 是 | 是否添加水印 |
| `seed` | `number` | - | 否 | 随机种子，用于稳定生成内容 |
| `stream` | `boolean` | `true` | 否 | 部分图片模型支持流式返回，平台按模型能力透传 |
| `outputFormat` | model-specific | - | 否 | 输出图片格式，例如 `png` |
| `sequentialImageGeneration` | model-specific | - | 否 | 组图生成模式，按模型能力支持|
| `onSSE` | `Function` | - | 否 | `stream=true` 时有效，接收 `{ eventName: string, data: string, id: string }`；`message` 事件的 `data` 是 JSON 字符串，例如 `{"path":"..."}` |
| `timeout` | `number` | `300000` | 否 | 请求超时时间，单位毫秒，默认 5 分钟 |
| `success` | `Function` | - | 否 | 调用成功回调 |
| `fail` | `Function` | - | 否 | 调用失败回调 |
| `complete` | `Function` | - | 否 | 调用结束回调 |

示例：

```javascript
tt.callAIGenerateImage({
  model: 'your-image-model-id',
  prompt: 'A clean mobile illustration of a sunrise over a quiet city.',
  size: '2K',
  watermark: true,
  stream: false,
  success(res) {
    const firstImage = res.data && res.data[0];
    if (!firstImage) return;
    console.log(firstImage.path, firstImage.size);
  },
  fail(error) {
    console.log(error.errMsg, error.errorCode, error.errorType);
  }
});
```

流式图片示例：

```javascript
function parseStreamData(rawData) {
  const text = String(rawData || '').trim().replace(/^data:\s*/, '');
  if (!text || text === '[DONE]') return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    console.log('Unable to parse stream data', error);
    return null;
  }
}

tt.callAIGenerateImage({
  model: 'your-image-model-id',
  prompt: 'A small robot holding a lantern, soft lighting.',
  size: '2K',
  watermark: true,
  stream: true,
  onSSE(event) {
    const payload = parseStreamData(event.data);
    if (payload && payload.path) {
      const preview = document.querySelector('[data-image-preview]');
      if (preview) {
        preview.src = payload.path;
        preview.hidden = false;
      }
    }
  },
  success(res) {
    console.log(res.created, res.data);
  }
});
```

图片流式 `event.data` 解析后的对象可能类似 `{"type":"image_generation.partial_succeeded","model":"xxxx","created":1782812298,"image_index":0,"size":"1600x2848","path":"ttfile://temp/DUjNuLGEdDRrJDu.jpeg"}`。作品内展示时应优先取 `path` 渲染预览，并可按需展示 `size` 或生成状态；不要把完整事件 JSON 当作图片结果文案。

成功回调参数：

| 属性名 | 类型 | 说明 |
| --- | --- | --- |
| `created` | `number` | 生成完成时间的 Unix 时间戳；仅 `stream=false` 时返回 |
| `data` | `object[]` | 最后生成的一组图片，数组项 `{ path: string, size: number }`，`path` 为本地 `ttfile://` 路径；仅 `stream=false` 时返回，`stream=true` 时图片经 `onSSE` 分片下发、`success` 仅返回 `errMsg` |

`data` 数组项：

```typescript
{
  path: string; // 本地路径 ttfile://…，可直接给 <img> 使用
  size: number; // 图片大小
}
```

### `tt.callAIGenerateVideo(options)`

用于调用模型生成视频。接口返回一个带 `abort()` 的任务对象，可用于取消视频生成任务。成功回调返回本地视频路径，适合通过作品内按钮触发 `<video>` 预览。

核心入参：

| 属性名 | 类型 | 默认值 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | `string` | - | 是 | 开发者传入的视频生成模型 ID 或 Endpoint |
| `content` | `object[]` | - | 是 | 生成内容输入数组，支持文本、图片路径、视频路径等内容项 |
| `resolution` | `string` | - | 是 | 输出分辨率，如 `480p`、`720p`、`1080p`，按模型能力支持 |
| `ratio` | `string` | - | 是 | 输出宽高比，如 `16:9`、`9:16`、`1:1`，按模型能力支持 |
| `duration` | `number` | - | 否 | 输出时长，单位秒；与 `frames` 二选一 |
| `frames` | `number` | - | 否 | 输出帧数；与 `duration` 二选一 |
| `seed` | `number` | - | 否 | 随机种子，用于稳定生成内容 |
| `cameraFixed` | `boolean` | - | 否 | 是否固定镜头，按模型能力支持 |
| `watermark` | `boolean` | - | 是 | 是否添加水印 |
| `generateAudio` | `boolean` | - | 否 | 是否生成有声视频，按模型能力支持 |
| `serviceTier` | `string` | - | 否 | 推理服务等级，按模型支持范围开放 |
| `maxPollTime` | `number` | `3600000` | 否 | 视频生成任务最大轮询时长，单位毫秒，默认 1 小时；轮询间隔固定为 10 秒 |
| `success` | `Function` | - | 否 | 调用成功回调 |
| `fail` | `Function` | - | 否 | 调用失败回调 |
| `complete` | `Function` | - | 否 | 调用结束回调 |

`content` 数组项：

```typescript
{
  type: 'text';
  text: string;
} | {
  type: 'image';
  path: string;
} | {
  type: 'video';
  path: string;
} | {
  type: 'audio';
  path: string;
}
```

各媒体项无需传入 `role`，基础库会自动为其标注 `reference_<type>` 角色。

文生视频示例：

```javascript
const task = tt.callAIGenerateVideo({
  model: 'your-video-model-id',
  content: [
    {
      type: 'text',
      text: 'A paper boat floating on a calm lake at sunset.'
    }
  ],
  resolution: '720p',
  ratio: '16:9',
  duration: 5,
  watermark: true,
  success(res) {
    console.log(res.videoPath);
  },
  fail(error) {
    console.log(error.errMsg, error.errorCode, error.errorType);
  }
});

// Call this from an explicit user action when cancellation is needed.
// task.abort();
```

图生视频示例：

```javascript
tt.chooseImage({
  count: 1,
  success(imageRes) {
    const imagePath = imageRes.tempFilePaths && imageRes.tempFilePaths[0];
    if (!imagePath) return;

    tt.callAIGenerateVideo({
      model: 'your-video-model-id',
      content: [
        {
          type: 'image',
          path: imagePath
        }
      ],
      resolution: '720p',
      ratio: '9:16',
      duration: 5,
      watermark: true,
      success(res) {
        console.log(res.videoPath);
      }
    });
  }
});
```

返回值：

| 属性名 | 类型 | 说明 |
| --- | --- | --- |
| `abort` | `Function` | 取消视频生成任务 |

成功回调参数：

| 属性名 | 类型 | 说明 |
| --- | --- | --- |
| `videoPath` | `string` | 生成视频的本地路径 |

视频生成任务按平台策略轮询，默认最大轮询时长由 `maxPollTime` 控制，当前说明中的轮询间隔固定为 10 秒；开发者侧不要自行实现额外轮询。

## 执行流程

必须严格按以下顺序执行。

### Step 1：需求归一化

先在内部完成以下判断，再开始写代码：

1. 玩法类型与核心循环是什么
2. 更适合 Canvas 还是 DOM
3. 目标方向是竖屏还是横屏
4. 是否需要存档
5. 是否需要多文件结构
6. 缺失项采用什么默认值

如果用户描述模糊，不要停在追问阶段；优先做最合理的默认补全，并在最终输出中显式写明。

### Step 2：合规门禁

生成前先做一次合规检查：

1. 检查内容是否触及安全红线
2. 检查需求是否违反平台限制
3. 如果不合规，停止生成代码，只输出：
   - 冲突点
   - 无法满足的原因
   - 一个或多个合规替代方向

### Step 3：生成代码

生成代码时，必须满足以下要求：

- 入口文件必须为 `index.html`
- 默认优先生成最小可玩版本，而不是过度扩展的复杂版本
- 单文件场景下，将 CSS、JS 尽量内联到 `index.html`
- 多文件场景下，仅拆分真正必要的 JS、图片、音频资源
- 小图标、按钮、简单图形优先用 CSS、SVG、Base64 或 Canvas 绘制
- 大背景图或音频仅在用户明确需要时才加入，并控制体积
- 动画优先使用 `requestAnimationFrame`
- 触控事件优先使用 Pointer 或 Touch 事件，并兼顾点击
- JS 语法按 `ios_safari: '13.4.0'` 与 `android_webview: '119'` 基线控制，避免使用超出目标运行环境的语法
- 不要使用 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write()`、`document.writeln()` 或 jQuery HTML 注入方法拼接界面；优先使用 `createElement`、`textContent`、`setAttribute`、`appendChild` 等 DOM API
- 不要使用 `onload=`、`onerror=`、`onclick=`、`ontouchstart=` 等 `onXXX=` 系列内联事件属性；事件绑定应通过 `addEventListener` 完成
- 不得调用地理位置、剪贴板、摄像头、麦克风等宿主敏感能力
- 默认不要调用 Service Worker、`document.execCommand` 等不支持或过时能力；改造历史作品时如无法立即移除，必须在自检中标记为 warn 风险
- 所有确认、提示、输入、结算相关交互，都要使用自绘弹层，不能调用 `alert()`、`confirm()`、`prompt()`、`print()`、`window.dialog`
- 如果存在弹层，优先采用上文“弹层实现模板”的覆盖层结构、类名切换方式和显式状态管理方式
- 面向用户的展示文案与 UI 命名应避免出现“游戏”字样，优先使用“互动”“挑战”“体验”“任务”“关卡”等表达
- 文字、按钮、分数、状态提示在小屏幕上必须可读可点
- 所有状态切换都要可恢复，不要出现“死局后无法重新开始”的情况

### Step 4：自动化扫描

生成完成后，必须使用本 skill 内置的 `h5-validator` 工具对产物进行自动化合规扫描。

**特别强调：最终产出 zip 包后，必须再对 zip 包执行一次扫描，确保扫描通过后才能交付。**

扫描工具路径：`[Skill Directory]/scripts/h5-validator`

执行命令：

```bash
node [Skill Directory]/scripts/h5-validator --required index.html --max-size 8388608 <产物路径>
```

- 产物路径可以是目录（单文件或多文件产物的根目录），也可以是打包后的 `.zip` 文件
- 默认已包含 `index.html` 为必需文件
- `--max-size 8388608` 校验总体积不超过 8MB（8 * 1024 * 1024 字节）
- 如输入为 `.zip` 文件，可加 `--output <解压目录>` 指定解压位置
- 如需生成 JSON 报告，可加 `--report json --report-name <报告名>`

扫描会自动执行以下规则：

安全类规则（block 级别，不通过则无法发布）：
- 动态代码检测（`eval`、`new Function` 等）
- 网络请求检测（`fetch`、`XMLHttpRequest` 等）
- 页面跳转检测（`window.location`、`window.open` 等）
- 外部链接检测（`http://`、`https://`、协议相对 URL 等）
- 内联事件检测（`onclick=`、`onerror=` 等）
- XSS 风险检测（`innerHTML`、`document.write` 等）

兼容性规则（warn 级别）：
- 不支持 API 检测（Service Worker、剪贴板等）
- 废弃 API 检测（`document.execCommand` 等）
- 浏览器兼容性检测（iOS Safari 13.4 / Android WebView 119 基线）

#### 打包后强制扫描

只要最终产物不是单个 `index.html`，而是多文件目录并打成 `.zip` 包，**必须在打包完成后立即对 zip 包再执行一次扫描**：

```bash
node [Skill Directory]/scripts/h5-validator --max-size 8388608 <zip包路径>
```

- 扫描必须全部通过（无 block 级别错误）才能交付
- 如有 warn 级别警告，应在自检报告中标注并说明
- 扫描不通过时，必须修复问题后重新打包和扫描，直到通过为止

### Step 5：自检

在给出最终结果前，必须逐项自检并在输出中展示结果。自动化扫描的结果可作为自检的重要参考，但不能完全替代人工自检。自检分为“强约束必过”和“warn 风险项”。

强约束必过：

- [ ] `index.html` 位于根目录，且 HTML 格式合法
- [ ] 预估包体小于 8MB
- [ ] 没有任何网络请求，包括 `fetch`、`XMLHttpRequest`、`axios`、`WebSocket`、`EventSource/SSE`
- [ ] 没有任何外部资源引用，包括 CDN、远程图片、远程字体、远程脚本、远程样式
- [ ] 没有 `http://`、`https://`、`//domain.com/xxx` 等外部 URL 或协议相对 URL
- [ ] 没有站外跳转、`target="_blank"`、`window.location`、`location.href`、`window.open` 或 `<iframe>`
- [ ] 没有地理位置、剪贴板、摄像头、麦克风等宿主敏感能力调用
- [ ] 如有弹层，使用的是作品内部覆盖层或 Canvas 自绘方案，而非浏览器原生对话框
- [ ] 如有弹层，同时只存在一个激活态主弹层，且显示或关闭由显式状态切换控制
- [ ] 所有资源都使用相对路径
- [ ] 没有横向滚动条
- [ ] 已适配目标方向与移动端尺寸
- [ ] 已包含错误兜底
- [ ] 如有存档或本地数据，使用的是带业务前缀的浏览器本地存储，且不依赖远端存储、Cookie 追踪或宿主敏感能力
- [ ] 如作品使用 `tt.callAIChatCompletion`、`tt.callAIGenerateImage`、`tt.callAIGenerateVideo` 等 AI 能力，每个实际调用的 `model` 均来自本轮用户输入；若项目内已有稳定模型常量，已先让用户确认复用或改填新模型 ID；若缺失，已在继续后续任务前向用户追问并等待输入，不得自行臆造默认模型或使用占位模型
- [ ] 内容不触及安全红线

warn 风险项：

- [ ] JS 语法已按 `ios_safari: '13.4.0'` 与 `android_webview: '119'` 基线检查；不满足时标记为 warn 风险
- [ ] 没有 `eval()`、`new Function()`、字符串形式 `setTimeout/setInterval` 等动态执行代码方式；如确有历史代码残留，必须标记为 warn 风险并建议替换
- [ ] 没有可能导致 XSS 的 HTML 注入模式：`innerHTML` / `outerHTML` 赋值、`insertAdjacentHTML`、`document.write()` / `document.writeln()`、jQuery `html()` / `append()` / `prepend()` 等；如确有历史代码残留，必须标记为 warn 风险并建议替换
- [ ] 没有 Service Worker、`alert()`、`confirm()`、`prompt()`、`print()`、`window.dialog` 等 webview 容器未支持能力调用；如确有历史代码残留，必须标记为 warn 风险并建议替换
- [ ] 没有 `document.execCommand` 等过时接口，也没有 `onXXX=` 系列内联事件属性；如确有历史代码残留，必须标记为 warn 风险并建议替换
- [ ] `<head>` 中或 `<body>` 顶部的阻塞渲染同步 `<script>` 标签不超过 3 个；超过时标记为 warn 风险

## 固定输出格式

只要进入代码生成阶段，最终回复必须严格按以下标题、顺序和粒度输出，不要省略，不要改标题，不要插入并列一级段落。

### 1. 产物概述

必须包含：

- 作品名称
- 玩法类型
- 屏幕方向
- 交付形态
- 一句话玩法说明

### 2. 假设与默认值

列出所有由你自动补全的关键设定，例如：

- 默认竖屏
- 默认单文件
- 默认点击交互
- 默认最高分存档

### 3. 文件结构

输出完整文件树。

如果是单文件，直接写：

```text
index.html
```

如果是多文件，输出完整目录结构。

### 4. 完整代码

按文件逐个输出完整代码内容。

要求：

- 文本文件必须给出完整代码
- 非文本资源如果无法直接展开，使用“资源清单”形式列出文件名、用途、建议格式、大小控制建议
- 不要只给片段，不要省略关键函数

### 5. 自检报告

按 Step 5 的自检清单逐条写"通过 / 风险 / 说明"。同时附上 Step 4 自动化扫描的结果摘要。

### 6. 使用说明

至少包含：

- 如何本地保存文件
- 如何压缩为 `.zip`：若为多文件产物，默认直接生成脚本并执行自动打包；同时说明进入的工作目录、压缩包内的预期结构、实际执行的命令或脚本内容，以及压缩时的工作目录
- 如何确保 `index.html` 位于压缩包根目录
- 如何在手机或 WebView 环境中测试
- 如何执行自动化合规扫描：
  - 扫描工具路径：`[Skill Directory]/scripts/h5-validator`
  - 扫描目录产物：`node [Skill Directory]/scripts/h5-validator --max-size 8388608 <产物目录路径>`
  - 扫描 zip 产物（打包后必须执行）：`node [Skill Directory]/scripts/h5-validator --max-size 8388608 <zip文件路径>`
  - 生成 JSON 报告：追加 `--report json --report-name <报告名>`
  - 扫描必须通过（无 block 级别错误）才能交付

## 默认实现

当用户没有特别指定时，优先采用以下策略：

- 默认生成单文件 `index.html`
- 默认所有落盘文件、目录、压缩包统一使用英文小写命名，单词之间优先使用连字符或下划线
- 默认竖屏
- 默认使用轻量实现，不引入大型第三方库
- 默认使用原创通用视觉元素，不碰任何知名 IP
- 默认提供开始、重开、分数展示、结束态四类基础界面
- 默认加入最基础的错误兜底与最高分存档

## 推荐文件结构

### 单文件

```text
index.html
```

### 多文件

```text
/
├── index.html
├── js/
│   └── main.js
├── images/
│   ├── bg.png
│   └── icon.png
└── audio/
    └── bgm.mp3
```

## 参考错误兜底

```javascript
window.addEventListener('load', () => {
  try {
    initApp();
  } catch (error) {
    console.error(error);
    const fallback = document.createElement('div');
    fallback.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fff;color:#111;font-size:18px;padding:24px;text-align:center;z-index:9999;';
    fallback.textContent = '哎呀，出错了，请重启试试吧~';
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    document.body.appendChild(fallback);
  }
});
```

## 玩法附录

以下内容不是固定模板，而是用于快速补全玩法规则。

### 三消类

- 推荐 8x8 网格
- 推荐 5 到 6 种元素
- 必须有交换、消除、掉落、补位、死局处理
- 建议加入步数限制和目标分数

### 合成类

- 明确等级序列
- 需要碰撞检测与合成反馈
- 必须有结束线或溢出判定

### 跑酷类

- 默认横屏更合适
- 至少包含跳跃、障碍、得分、重开
- 速度增长要平滑

### 棋类与益智类

- 必须确保题目可解
- 要有错误提示、重开或新局机制
- 竖屏优先

### 互动剧情类

- 分支数据应直接内置在代码中
- 至少提供 3 个结局更完整
- 禁止通过 `fetch` 加载外部剧情 JSON

### 物理模拟类

- 只实现必要的轻量物理
- 注意性能开销
- 默认横屏更合适

## 常见失败原因

| 问题 | 常见原因 | 处理方式 |
| --- | --- | --- |
| 上传后提示缺少入口 | `index.html` 不在根目录 | 确保压缩包解压后根目录直接可见 `index.html` |
| 页面白屏 | 运行时报错或路径错误 | 添加全局兜底并检查相对路径 |
| 资源失效 | 使用了外链或绝对路径 | 全部改为本地相对路径 |
| XSS 风险预检 WARN | 使用 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write()` 或 jQuery HTML 注入方法 | 改为 `createElement`、`textContent`、`setAttribute`、`appendChild` 等 DOM API |
| 包体超限 | 图片、音频、第三方库过大 | 压缩资源并减少不必要资产 |
| 手机显示不全 | 没做自适应或固定像素布局 | 使用响应式布局或 Canvas 缩放 |