# iPad Draw Bridge

- Original name: iPad 用 Apple Pencil 遙控 Windows 滑鼠畫圖
- English filename name: ipad-draw-bridge
- Intake status: Assumed and implemented as MVP

## Goal

讓使用者在 iPad 上使用 Apple Pencil 畫線，並即時轉成 Windows 電腦的滑鼠按住拖曳，讓 Windows 繪圖軟體同步畫圖。

## Target Users

- 需要臨時把 iPad 當繪圖板使用的 Windows 使用者
- 沒有專業繪圖板，但想用 Apple Pencil 在電腦繪圖的人

## Core Features

- iPad 網頁畫板（支援 Pencil 指標事件）
- 即時傳輸筆跡事件到 Windows
- Windows 模擬滑鼠移動與左鍵按住/放開

## Platform Scope

- iPad Safari
- Windows 10/11（Node.js）

## UI Theme and Visual Direction

極簡控制面板風格，優先連線狀態與低延遲繪圖預覽。

## Key User Flows

1. Windows 開啟服務
2. iPad 連線到同一個 LAN URL
3. 用 Pencil 在 iPad 畫圖
4. Windows 繪圖軟體同步出現滑鼠筆跡

## Data and Authentication

- 不儲存歷史資料
- 僅局域網即時事件傳輸

## Integrations

- Windows user32 API（SetCursorPos / mouse_event）

## Delivery Plan and MVP Scope

已交付 MVP：單機服務、iPad 前端、Windows 滑鼠注入、座標映射測試。

## Success Metrics

- 可在 1 分鐘內完成連線
- 滑鼠軌跡與 Pencil 路徑方向一致
- 可在 Windows Paint 連續畫線

## Open Questions

- 是否要加密或配對碼
- 是否要多螢幕指定
- 是否要壓感映射（不同筆刷粗細）
