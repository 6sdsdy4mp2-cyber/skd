# PhotoFlow Cloud（免費方案照片交接版）

兩位員工使用各自的 Firebase Email/Password 帳戶，在不同電腦即時交接照片。

## 本版本的儲存方式
- Firebase Authentication：員工登入。
- Cloud Firestore：工作資料及照片分段資料。
- 不使用 Firebase Storage，因此不需要為 Storage 升級 Blaze 或連結帳單帳戶。
- 瀏覽器會將圖片縮放至最長邊 2000px，轉成 WebP（不支援時使用 JPEG），壓縮後最多 8MB，再切成每段 450KiB 的資料寫入 Firestore。
- 原始檔選擇上限 25MB；超過壓縮上限會提示使用者選擇較小照片。

## 重要限制
這是小型、低流量的兩人工作流程方案，不是大型相片庫。Firestore 每份文件上限為 1MiB，故照片必須壓縮及分段。照片讀取及寫入仍會消耗 Firestore 免費額度；免費額度不是無限，請留意 Firebase Console 的用量頁面。若大量傳送高解析照片或頻繁下載，可能超出免費額度或儲存空間。

## Firebase 已設定資料
`public/firebase-config.js` 已填入你提供的 Web App 設定，員工二 UID 亦已填入。請不要把 Firebase Admin SDK 私密金鑰放進前端。

## 部署前確認
1. Firebase Authentication 已啟用 Email/Password，並已建立兩位員工帳戶。
2. Firestore `users` 集合中：
   - 文件 ID `fO4VF5P12kQKdlH9fg3TtgLuid42`，欄位 `role` = `employee1`
   - 文件 ID `1aGRoTUJpyVLYTt3RXO6Ogup7NU2`，欄位 `role` = `employee2`
3. Firestore 資料庫已建立。
4. 不需要建立 Firebase Storage。

## 部署 Firestore 規則及網站
需要安裝 Node.js LTS：https://nodejs.org/

在專案資料夾開啟終端機，執行：

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,hosting
```

專案已設定 Firebase Project ID：`photoflow-7bdaf`。若 Firebase CLI 詢問專案，選擇這個專案。

部署完成後，CLI 會顯示 Hosting 網址，通常是：
`https://photoflow-7bdaf.web.app`

## 使用流程
### 員工一
1. 登入。
2. 填寫工作名稱及修圖要求。
3. 選擇原始照片並按「上傳原圖並傳送工作」。
4. 等待員工二交回成品。
5. 按「下載完成照片」。

### 員工二
1. 登入。
2. 在工作清單查看新工作。
3. 下載原始照片。
4. 使用修圖軟件完成修整。
5. 按「上傳完成照片」交回成品。

## 安全及測試
- `firestore.rules` 限制只有工作建立者及被指派的員工讀取工作及照片分段；員工一只能建立原圖分段，員工二只能建立成品分段。
- 員工角色必須由管理員在 Firebase Console 手動設定；前端不能自行改角色。
- 上線前請用兩個真實帳戶及兩部電腦測試：登入、上傳原圖、員工二下載、交回成品、員工一下載，以及未登入時不能讀取。
- 若 Firestore 顯示 `permission-denied`，先確認兩筆 `users` 文件 ID 和 role 完全正確，並確認已部署新版 `firestore.rules`。
