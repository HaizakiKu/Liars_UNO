# Liar's UNO · 在线说谎版 UNO

按 **Liar's UNO 官方规则**实现的多人在线网页桌游。玩家创建房间、分享链接或进入公开房间一起玩，可以加入电脑玩家补位。前后端都运行在 **Cloudflare Workers + Durable Objects** 上。

- 出牌、暗出、质疑亮牌、7 换手、0 传牌、摸牌、洗牌、说谎挑战等过程都有对应动画（Motion 共享布局与弧线飞行）。
- 中英双语，可在右上角切换。
- 桌面与手机自适应。
- 色盲标记（○ ✦ ▽ □）印在每张牌上。
- 卡面为原创 CSS/SVG 绘制，不使用官方美术素材。

## 牌组（112 张）

| 牌 | 数量 | 类型 |
|---|---|---|
| 数字 0–9 × 4 色 | 40 | 普通牌（正面朝上打出） |
| 数字 0–9 × 4 色 | 40 | 说谎牌（背面朝上打出） |
| 跳过 / 反转 / +2 × 4 色 × 2 | 24 | 说谎牌 |
| 变色 +4 | 2 | 说谎牌 |
| 说谎挑战（Wild Liar's Challenge） | 6 | 普通牌 |

## 规则要点与线上化处理

### 出牌与声明

- **说谎牌**：
  - 必须暗出，并从合理的声明中选一个。
  - 合理声明 = 能接在当前顶牌上的牌：同色、同数字或同符号，或者变色 +4。
  - 界面只列出合法声明，默认选中真实身份，诚实出牌一键完成。
- **暗出普通牌**：
  - 这是违规操作，作为房间选项提供，默认开启。
  - 被质疑抓到就收回并罚摸 6 张。
  - 操作方式：右键或长按普通牌；不匹配的普通牌直接点击。

### 质疑

- **质疑窗口**：每次暗出后开启，时长 4 / 6 / 10 秒可调。除出牌者外，每个人都可以“相信”或“质疑”，最先发出的质疑生效。
- **说真话**：质疑者罚摸 1 张，效果照常生效。7 和 0 的罚牌在换手之后再摸。
- **说谎**：出牌者收回那张牌并罚摸 1 张，效果作废。
- **没人质疑**：按声明生效，包括行动牌效果。

### 特殊牌

- **7 换手**：与选定的玩家交换手牌。
- **0 传牌**：所有人按当前方向把手牌传给下家。
- **Reverse**：两人对局时等同于 Skip。
- **说谎挑战**：
  1. 出牌者正面打出并指定一种颜色。
  2. 其他人各自暗放一张牌。
  3. 出牌者逐个点名质疑。
  4. 一旦有人亮出真的该色牌，或所有人都已被质疑，或出牌者主动结束，该玩家和所有未被质疑的人把牌压到挑战牌下。
  5. 借此出完手牌的人获胜，可以多人同时获胜。

### UNO 与胜负

- **UNO**：手牌剩 1 张时要喊 UNO，剩 2 张时可以提前喊。在下一位玩家行动之前被别人抓到，罚摸 2 张。
- **计分**：可选“单局”或累计到 200 / 500 分。数字牌按面值计分，行动牌 20 分，万能牌 50 分。

### 计时与托管

- **超时**：每回合可设 15 / 30 / 60 秒，超时自动摸牌并结束回合。
- **托管**：
  - 连续两次超时或掉线时由电脑托管。
  - 用同一浏览器重连即可恢复原座位和手牌。
  - 对局中主动离开，座位由电脑接管到本局结束。

## 架构

```
src/shared/   纯 TypeScript 规则引擎、视图、Bot 和协议，前后端共用
  engine.ts     状态机：applyAction / applyTimeout / createRound，不修改输入，随机种子保存在状态中
  view.ts       按玩家生成脱敏视图和事件：暗牌、牌堆顺序、他人手牌一律不下发
  bot.ts        电脑玩家：记牌、虚张、质疑概率、说谎挑战策略，只使用自己的视图
src/worker/   Cloudflare Worker
  index.ts      /api 路由；其余路径由静态资源（SPA）处理
  room-do.ts    RoomDO：每个房间一个 Durable Object（SQLite 后端）
  lobby-do.ts   LobbyDO：全局公开房间索引（SQLite 表），通过 WebSocket 实时推送
src/client/   React 19 + Motion + zustand 前端
```

### RoomDO

`RoomDO` 是每个房间的权威状态机：

- **连接**：使用 WebSocket Hibernation API，空闲时不占用内存。
- **持久化**：每次变化都写入 Durable Object 存储，被驱逐后可以原样恢复。
- **计时**：回合超时、质疑窗口、Bot 行动、断线宽限、房间清理和大厅心跳共用一个 alarm。
- **并发**：所有动作在 DO 内串行执行。Bot 的动作在计划时绑定状态版本号，状态变了就作废重新计划。

### 房间生命周期

1. **创建房间**：Worker 生成 6 位房间码，调用 `init()`。房间码已被占用就重试。
2. **加入**：首个真人成为房主。房主离线超过 30 秒，自动移交给下一位真人。
3. **身份**：浏览器本地保存 `playerId` 和随机 token，DO 只存 token 的 SHA-256。重连必须带上相同的 token。
4. **清理**：
   - 房间无人在线时，等待中的房间 2 分钟后删除，对局中的房间 5 分钟后删除。
   - 超过 1 小时没有任何消息也会删除。
   - 删除时调用 `deleteAll()`，并从大厅移除。
5. **大厅一致性**：大厅条目带过期时间。房间在状态变化时和每分钟刷新一次，LobbyDO 定时清理过期条目，所以异常消失的房间也不会一直挂在列表里。
6. **防护**：每个 WebSocket 限速，消息上限 4 KB，昵称和房名会过滤控制字符并限制长度。

## 本地开发

```bash
npm install
npm run dev          # Vite + Cloudflare 插件，本地 workerd 运行 Worker 和 Durable Objects
```

## 测试

```bash
npm run typecheck    # 前端、Worker、测试三套 tsconfig
npm test             # 规则单元测试，以及数百局 Bot + 随机动作模拟（检查 112 张守恒、能否结束、信息是否泄露）
npm run build
npm run test:ws      # 对本地 workerd 跑 WebSocket 集成测试：大厅、建房、加入、Bot、重连、清理
npm run test:e2e     # Playwright 端到端测试：桌面和手机视口、单人对 Bot、双人、观战、刷新重连、离开托管
```

## 部署到 Cloudflare（Workers Builds 连接 GitHub）

1. 登录 Cloudflare Dashboard，进入 **Workers & Pages → Create → Import a repository**，授权 GitHub 并选择本仓库。
2. 构建设置：

   | 项目 | 值 |
   |---|---|
   | Project / Worker name | `liars-uno`，必须与 `wrangler.jsonc` 里的 `name` 一致 |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | `/` |
   | Production branch | 合并代码的分支（例如 `main`） |

3. 保存后，每次推送到生产分支都会自动构建并部署。
   - 首次部署会根据 `migrations` 自动创建 `RoomDO` 和 `LobbyDO` 两个 SQLite Durable Object 类，Free 计划即可使用。
   - 部署完成后访问 `https://liars-uno.<你的子域>.workers.dev`。
4. 可选：在 Worker 的 **Settings → Domains & Routes** 绑定自定义域名。

也可以在本地手动部署：`npx wrangler login && npm run deploy`。
