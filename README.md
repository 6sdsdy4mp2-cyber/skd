# PhotoFlow Cloud（兩位員工雲端照片交接系統）

這是一個真正連接 Firebase 的雲端 Web App。員工一上傳原圖建立工作，員工二在另一部電腦登入後即時看到工作，下載原圖並上傳成品；員工一會即時看到「已交回」狀態並下載成品。

## 功能
- Firebase Email/Password 登入（不提供公開註冊）
- 兩個角色：`employee1`、`employee2`
- Firestore 即時工作同步
- Firebase Storage 雲端照片儲存
- 原圖 / 成品分開儲存
- Firestore 與 Storage Security Rules
- 單張圖片限制 25MB，支援 JPG、PNG、WEBP

## 重要：部署前需要你自己的 Firebase 專案
本專案不包含任何真實 Firebase 金鑰、帳戶或雲端儲存空間。必須由你建立 Firebase 專案並填入自己的設定，才會成為可用的雲端系統。

## A. 建立 Firebase 專案
1. 前往 https://console.firebase.google.com/，使用 Google 帳戶登入。
2. 建立專案，例如 `photoflow-team`。
3. 在專案總覽按「新增應用程式」並選 Web（</>）。
4. 登記應用程式名稱 `PhotoFlow`，取得 Firebase Web App config。
5. 將設定填入 `public/firebase-config.js`，不要保留 `YOUR_...` 佔位文字。
6. Firebase Console -> Authentication -> Get started -> Sign-in method，啟用 **Email/Password**。
7. Authentication -> Users -> Add user，建立兩個員工帳戶。不要開放公開註冊。
8. 在 Authentication 使用者清單複製兩個 UID。

## B. 建立員工角色資料
Firebase Console -> Firestore Database -> Create database（建議選 production mode，位置選接近團隊的區域）。

建立 `users` collection，建立以下兩份文件。文件 ID 必須是該員工的 Authentication UID：

文件一（ID = 員工一 UID）：
```json
{
  "displayName": "員工一",
  "role": "employee1"
}
```

文件二（ID = 員工二 UID）：
```json
{
  "displayName": "員工二",
  "role": "employee2"
}
```

在 `public/firebase-config.js` 將 `employee2Uid` 設為員工二的 Authentication UID。這讓員工一建立工作時，系統知道要分配給哪位員工。

## C. 啟用 Firebase Storage
Firebase Console -> Storage -> Get started，建立儲存空間。建議選擇與 Firestore 相同或接近的區域。
本專案的 `storage.rules` 會限制只有兩個已登記角色的登入員工，才可存取自己參與的工作照片。

## D. 安裝 Firebase CLI 並部署
需要安裝 Node.js LTS。下載：https://nodejs.org/

在專案資料夾開啟終端機：
```bash
npm install -g firebase-tools
firebase login
```

將 `.firebaserc.example` 複製成 `.firebaserc`，並把 `YOUR_FIREBASE_PROJECT_ID` 改成你的 Firebase Project ID。

在專案根目錄執行：
```bash
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore:rules,storage
firebase deploy --only hosting
```

部署完成後，Firebase CLI 會顯示 Hosting 網址，通常形如：
`https://YOUR_PROJECT_ID.web.app`

將同一網址交給員工一和員工二。兩人使用各自帳戶，在不同電腦登入即可。

## E. 本機測試（可選）
```bash
firebase emulators:start
```
注意：若使用 Emulator，需另行設定前端連接 Emulator；目前預設前端連接正式 Firebase 專案。

## 操作流程
### 員工一
1. 登入。
2. 填寫工作名稱、修圖要求。
3. 選擇一張原始照片。
4. 按「上傳原圖並傳送工作」。
5. 等待工作狀態變成「已交回」。
6. 按「下載完成照片」。

### 員工二
1. 登入。
2. 新工作會即時出現在工作清單。
3. 按「下載原始照片」。
4. 在自己的修圖軟件完成修整。
5. 按「上傳完成照片」，選擇成品。
6. 上傳完成後，工作狀態會變成「已交回」。

## 安全及營運提醒
- 這個版本只支援每個工作上傳一張原圖及一張完成照片。
- 目前沒有管理員介面；帳戶及角色由 Firebase Console 管理。
- 不要將 Firebase Admin SDK 私密金鑰放進前端。
- Firebase Web API key 會出現在瀏覽器是正常設計；真正的存取保護由 Authentication、Firestore Rules 和 Storage Rules 執行。
- 請在 Firebase Console 設定預算提醒。Firebase 服務的免費額度及收費會因方案、地區和使用量而異；不要假設永遠免費。
- 上線前請用兩個真實帳戶、兩部不同電腦完整測試：登入、上傳原圖、員工二讀取、交回成品、員工一下載，以及未登入時不能讀取。
- 建議使用 HTTPS（Firebase Hosting 預設提供）。
