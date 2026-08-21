# HedgeDoc menmen 定制 patch 记录

基线：官方 `1.10.3`（commit d8b94026），分支 `feature/menmen-custom`。

## 源码勘察（P0）

| 模块 | 路径 | 说明 |
|---|---|---|
| OT / Socket.io | `lib/realtime.js` | `ifMayEdit` L620–647；`operationCallback` L650；`permission` 事件 L771–814；`buildUserOutData` L590（含 `photo`）；`emitOnlineUsers` L297 |
| 笔记路由 | `lib/web/note/router.js` | `/new` L21–25；`/s/` L27–29；`/p/` L31–33 |
| OAuth2 | `lib/web/auth/oauth2/index.js` | `parseProfile` L58–75 |
| 用户头像解析 | `lib/models/user.js` | `parsePhotoByProfile` L85（oauth2 走 default → letter avatar） |
| 编辑器 UI | `public/views/hedgedoc/header.ejs` | navbar-brand L16；ui-new L119；ui-publish L125 |
| 在线用户 UI | `public/js/index.js` | `showStatus` L968；`online users` handler L2688；`updateOnlineUserList` L2795 |
| 配置 | `lib/config/environment.js` | OAuth2 / DB 环境变量 |

## Patch 序列

| # | 镜像 tag | 内容 | 文件 |
|---|---|---|---|
| 1 | menmen.1 | MySQL 判权 + OT 拦截 + 封禁 permission 事件 | `lib/menmen-perm.js`, `lib/realtime.js`, `lib/config/environment.js`, `lib/config/index.js` |
| 2 | menmen.2 | OAuth2 avatar + Auth userinfo | `lib/web/auth/oauth2/index.js`, `lib/models/user.js`, `aristotle/auth/.../Oauth2ServiceImpl.java` |
| 3 | menmen.3 | UI 精简 + 路由封禁 + Avatar Group + 只读隐藏模式切换 | `lib/menmen-routes.js`, `public/css/menmen-custom.css`, `public/js/index.js`, `public/views/hedgedoc/header.ejs`, `app.js` |
| 4 | — | Compose / .env / GRANT SQL | `aristotle/docker-compose/hedgedoc/` |

## P1 补充（2026-08）

- `lib/realtime.js` `ifMayEdit`：缓存 miss 时用 `socket.menmenCanEdit` 兜底，避免 TTL 过期后误拒可写用户
- 只读用户：`menmen-permission-denied` → `applyMenmenReadonly()` 隐藏 `.ui-mode-group` / 编辑区 / 工具栏，强制 View

## 测试

| 文件 | 覆盖 |
|---|---|
| `test/menmen/menmen-perm.test.js` | TC-P1-U01–U14（判权单元） |
| `test/menmen/routes-block.test.js` | TC-P3-R01–R05（路由封禁） |
| `test/menmen/fixtures/perm-matrix.sql` | §8 #5 双侧一致性 fixture |

## 维护契约

blog `ArticleAccessServiceImpl.canEdit()` 变更时，同步 `lib/menmen-perm.js` 内 SQL，并回归 `test/menmen/menmen-perm.test.js` 与 §8 #5。
