# iPad Draw Bridge

把 iPad + Apple Pencil 變成 Windows 繪圖輸入裝置。

## 功能重點

- 桌面 App 啟動時同時啟動 Bridge Server
- App 內可開「真實螢幕框選」設定可畫區域
- iPad 畫板會跟電腦框選比例自動調整，避免圓形變形
- iPad 支援「清除本地筆跡」按鈕與雙指雙擊清除
- 桌面 App 可勾選「顯示 iPad 本地筆跡預覽」

## 安裝

```powershell
npm.cmd install
```

## 桌面 App（推薦）

```powershell
npm.cmd run app:start
```

使用流程：

1. 開 App，Server 會自動啟動。
2. 按 `按此進行調教大小`，在 Overlay 拖拉畫框，按 `套用框選`。
3. 在 App 複製 iPad 連結（已帶 token），用 iPad Safari 打開。
4. 用 Apple Pencil 畫圖。

## iPad 畫板功能

- 畫板 active 區比例會跟隨電腦框選比例
- `清除 iPad 筆跡` 只清除 iPad 本地預覽，不影響電腦畫面
- 雙指雙擊可快速清除本地筆跡

## 桌面 App 顯示模式

勾選 `顯示 iPad 本地筆跡預覽`：

- 開：iPad 會顯示本地筆跡
- 關：iPad 不顯示筆跡（仍會傳到電腦繪圖）

## 安全性

- 預設強制 token 配對
- WebSocket 連線驗證 token
- API 預設只允許本機或有效 token
- 單一 iPad 連線鎖
- 中斷時自動放開滑鼠

