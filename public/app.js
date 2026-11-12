import { firebaseConfig, employee2Uid } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, onSnapshot, addDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const $ = id => document.getElementById(id);
const loginView = $("loginView"), appView = $("appView");
let auth, db, storage, currentUser = null, profile = null, unsubscribe = null, taskMap = new Map();

function showError(id, message="") { $(id).textContent = message; }
function notify(message) {
  const t = $("toast"); t.textContent = message; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}
function friendlyError(error) {
  const code = error?.code || "";
  const map = {
    "auth/invalid-credential":"電郵或密碼不正確。",
    "auth/user-disabled":"此帳戶已停用，請聯絡管理員。",
    "auth/too-many-requests":"登入嘗試次數過多，請稍後再試。",
    "storage/unauthorized":"沒有權限存取這張照片，請檢查員工帳戶及 Storage Rules。",
    "permission-denied":"資料庫拒絕此操作，請檢查員工角色及 Firestore Rules。",
    "unavailable":"網絡暫時無法連接，請稍後再試。"
  };
  return map[code] || error?.message || "操作失敗，請稍後再試。";
}
function formatDate(ts) {
  if (!ts?.toDate) return "剛剛";
  return ts.toDate().toLocaleString("zh-HK");
}
function safeText(value="") { return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function initFirebase() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
    throw new Error("請先編輯 public/firebase-config.js，填入 Firebase Web App 設定。");
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app); storage = getStorage(app);
  onAuthStateChanged(auth, async user => {
    if (!user) { cleanup(); loginView.classList.remove("hidden"); appView.classList.add("hidden"); return; }
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || !["employee1","employee2"].includes(snap.data().role)) {
        await signOut(auth);
        showError("loginError", "此帳戶尚未獲授權。請管理員建立員工角色資料。");
        return;
      }
      currentUser = user; profile = snap.data();
      loginView.classList.add("hidden"); appView.classList.remove("hidden");
      $("userName").textContent = profile.displayName || (profile.role === "employee1" ? "員工一" : "員工二");
      $("userRole").textContent = profile.role === "employee1" ? "照片交件人" : "照片處理人";
      $("avatar").textContent = profile.role === "employee1" ? "一" : "二";
      $("welcomeText").textContent = profile.role === "employee1"
        ? "建立工作並傳送原圖，等待員工二交回成品。"
        : "查看員工一傳來的照片，處理後上傳成品。";
      $("createForm").classList.toggle("hidden", profile.role !== "employee1");
      $("listTitle").textContent = profile.role === "employee1" ? "已傳送的照片工作" : "待處理及已接收工作";
      $("listSubtitle").textContent = profile.role === "employee1" ? "工作及成品狀態會即時同步。" : "選擇工作、下載原圖並交回完成照片。";
      subscribeTasks();
    } catch (e) {
      console.error(e); await signOut(auth);
      showError("loginError", friendlyError(e));
    }
  });
}
function cleanup() { if (unsubscribe) unsubscribe(); unsubscribe = null; currentUser = null; profile = null; taskMap.clear(); }

function subscribeTasks() {
  if (unsubscribe) unsubscribe();
  const field = profile.role === "employee1" ? "createdBy" : "assignedTo";
  const q = query(collection(db, "tasks"), where(field, "==", currentUser.uid));
  unsubscribe = onSnapshot(q, snap => {
    taskMap.clear();
    snap.forEach(d => taskMap.set(d.id, { id:d.id, ...d.data() }));
    renderTasks();
  }, err => { console.error(err); $("taskList").innerHTML = `<div class="empty">${safeText(friendlyError(err))}</div>`; });
}

function renderTasks() {
  const tasks = [...taskMap.values()].sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $("statAll").textContent = tasks.length;
  $("statActive").textContent = tasks.filter(t => t.status !== "completed").length;
  $("statDone").textContent = tasks.filter(t => t.status === "completed").length;
  const list = $("taskList");
  if (!tasks.length) {
    list.innerHTML = `<div class="empty">${profile.role === "employee1" ? "尚未建立工作。請在上方建立第一個照片工作。" : "目前沒有分配給你的照片工作。新工作會自動出現在這裡。"}</div>`;
    return;
  }
  list.innerHTML = tasks.map(t => {
    const statusText = t.status === "completed" ? "已交回" : t.status === "processing" ? "處理中" : "等待處理";
    const originalName = t.originalFile?.name ? `<div class="file-name">原圖：${safeText(t.originalFile.name)}</div>` : "";
    const processedName = t.processedFile?.name ? `<div class="file-name">成品：${safeText(t.processedFile.name)}</div>` : "";
    const actions = profile.role === "employee1"
      ? (t.processedFile ? `<button class="btn primary" data-download="${safeText(t.id)}" data-kind="processed">下載完成照片</button>` : `<span class="muted small">等待員工二處理並交回</span>`)
      : (t.status === "completed"
        ? `<span class="muted small">此工作已交回員工一</span>`
        : `<button class="btn secondary" data-download="${safeText(t.id)}" data-kind="original" ${t.originalFile ? "" : "disabled"}>下載原始照片</button>
           <button class="btn primary" data-process="${safeText(t.id)}">上傳完成照片</button>`);
    return `<article class="task">
      <div class="task-top"><div><h3>${safeText(t.title || "照片工作")}</h3><div class="task-meta">建立時間：${formatDate(t.createdAt)}</div></div><span class="status ${t.status}">${statusText}</span></div>
      ${t.note ? `<div class="task-note">${safeText(t.note)}</div>` : ""}
      ${originalName}${processedName}
      <div class="task-actions">${actions}</div>
    </article>`;
  }).join("");
  list.querySelectorAll("[data-download]").forEach(b => b.addEventListener("click", () => downloadTask(b.dataset.download,b.dataset.kind)));
  list.querySelectorAll("[data-process]").forEach(b => b.addEventListener("click", () => chooseProcessed(b.dataset.process)));
}

async function downloadTask(taskId, kind) {
  try {
    const task = taskMap.get(taskId), meta = kind === "original" ? task?.originalFile : task?.processedFile;
    if (!meta?.path) throw new Error("找不到照片檔案。");
    const url = await getDownloadURL(ref(storage, meta.path));
    const a = document.createElement("a"); a.href = url; a.download = meta.name || "photoflow-image"; a.target = "_blank";
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { console.error(e); notify(friendlyError(e)); }
}

async function createTask(event) {
  event.preventDefault(); showError("createError");
  const title = $("taskTitle").value.trim(), note = $("taskNote").value.trim(), file = $("originalImage").files[0];
  if (!title || !file) return showError("createError","請填寫工作名稱並選擇原始照片。");
  if (!file.type.startsWith("image/") || !["image/jpeg","image/png","image/webp"].includes(file.type))
    return showError("createError","只支援 JPG、PNG 或 WEBP 圖片。");
  if (file.size > 25 * 1024 * 1024) return showError("createError","單張照片不可超過 25MB。");
  if (!employee2Uid || employee2Uid.includes("PASTE_")) return showError("createError","請先在 firebase-config.js 設定員工二的 Firebase UID。");
  const btn = $("createBtn"); btn.disabled = true; btn.textContent = "正在上傳及傳送……";
  let taskRef;
  try {
    taskRef = await addDoc(collection(db,"tasks"), {
      title, note, createdBy: currentUser.uid, assignedTo: employee2Uid,
      status:"waiting", originalFile:null, processedFile:null,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    const path = `tasks/${taskRef.id}/original/${Date.now()}_${file.name.replace(/[^\w.\-]/g,"_")}`;
    await uploadBytes(ref(storage,path),file,{contentType:file.type});
    await updateDoc(taskRef,{originalFile:{name:file.name,path,size:file.size,type:file.type},updatedAt:serverTimestamp()});
    $("createForm").reset(); notify("原始照片已上傳，工作已傳送給員工二。");
  } catch(e) {
    console.error(e);
    showError("createError",friendlyError(e) + (taskRef ? " 工作記錄已建立；如上傳中斷，請重新整理並聯絡管理員。" : ""));
  } finally { btn.disabled=false; btn.textContent="上傳原圖並傳送工作"; }
}

async function chooseProcessed(taskId) {
  const task = taskMap.get(taskId);
  if (!task) return;
  const input = document.createElement("input"); input.type="file"; input.accept="image/jpeg,image/png,image/webp";
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return notify("只支援 JPG、PNG 或 WEBP。");
    if (file.size > 25*1024*1024) return notify("單張照片不可超過 25MB。");
    try {
      const taskRef = doc(db,"tasks",taskId);
      if (task.status !== "processing") await updateDoc(taskRef,{status:"processing",updatedAt:serverTimestamp()});
      const path = `tasks/${taskId}/processed/${Date.now()}_${file.name.replace(/[^\w.\-]/g,"_")}`;
      notify("正在上傳完成照片……");
      await uploadBytes(ref(storage,path),file,{contentType:file.type});
      await updateDoc(taskRef,{
        processedFile:{name:file.name,path,size:file.size,type:file.type},
        status:"completed",updatedAt:serverTimestamp()
      });
      notify("完成照片已交回員工一。");
    } catch(e) { console.error(e); notify(friendlyError(e)); }
  };
  input.click();
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); showError("loginError");
  $("loginBtn").disabled=true; $("loginBtn").textContent="登入中……";
  try { await signInWithEmailAndPassword(auth,$("email").value.trim(),$("password").value); }
  catch(e) { showError("loginError",friendlyError(e)); }
  finally { $("loginBtn").disabled=false; $("loginBtn").textContent="登入工作台"; }
});
$("logoutBtn").addEventListener("click", () => signOut(auth));
$("createForm").addEventListener("submit", createTask);

try { initFirebase(); }
catch(e) { showError("loginError",e.message); console.error(e); }
