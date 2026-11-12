import { firebaseConfig, employee2Uid } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, onSnapshot, addDoc, updateDoc, serverTimestamp, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
const loginView = $("loginView"), appView = $("appView");
let auth, db, currentUser = null, profile = null, unsubscribe = null, taskMap = new Map();

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
    "resource-exhausted":"Firestore 免費額度或儲存限制可能已達上限，請稍後再試。",
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

async function saveHandover(taskId) {
  try {
    const text = document.querySelector(`[data-handover-text="${CSS.escape(taskId)}"]`)?.value.trim() || "";
    const link = document.querySelector(`[data-handover-link="${CSS.escape(taskId)}"]`)?.value.trim() || "";
    if (link && !/^https?:\/\//i.test(link)) return notify("連結必須以 http:// 或 https:// 開頭。");
    await updateDoc(doc(db,"tasks",taskId),{handoverText:text,handoverLink:link,attachments:taskMap.get(taskId)?.attachments || [],updatedAt:serverTimestamp()});
    notify("工作交接內容已同步。");
  } catch(e) { console.error(e); notify(friendlyError(e)); }
}

async function uploadAttachments(taskId, fileList) {
  const files = [...(fileList || [])]; if (!files.length) return;
  try {
    const task = taskMap.get(taskId); if (!task) throw new Error("找不到工作。");
    const current = [...(task.attachments || [])];
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) throw new Error(`附件「${file.name}」超過 8MB，請選擇較小檔案。`);
      const meta = await uploadRawChunks(taskId,file);
      current.push(meta);
      await updateDoc(doc(db,"tasks",taskId),{attachments:current,updatedAt:serverTimestamp()});
    }
    notify(`已新增 ${files.length} 個附件。`);
  } catch(e) { console.error(e); notify(friendlyError(e)); }
}

async function uploadRawChunks(taskId,file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileId = crypto.randomUUID(), total = Math.ceil(bytes.length / IMAGE_CHUNK_BYTES);
  const chunksRef = collection(db,"tasks",taskId,"files","attachment","uploads",fileId,"chunks");
  for(let index=0; index<total; index++) {
    const slice=bytes.subarray(index*IMAGE_CHUNK_BYTES,Math.min((index+1)*IMAGE_CHUNK_BYTES,bytes.length));
    let binary=""; for(let i=0;i<slice.length;i++) binary+=String.fromCharCode(slice[i]);
    await setDoc(doc(chunksRef,String(index).padStart(5,"0")),{index,data:btoa(binary),createdAt:serverTimestamp()});
  }
  return {fileId,chunkCount:total,name:file.name,type:file.type || "application/octet-stream",size:file.size};
}

function initFirebase() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
    throw new Error("請先編輯 public/firebase-config.js，填入 Firebase Web App 設定。");
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app);
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
    const originals = Array.isArray(t.originalFiles) ? t.originalFiles : (t.originalFile ? [t.originalFile] : []);
    const originalName = originals.map((f,i) => `<div class="file-name">原圖 ${i+1}/${originals.length}：${safeText(f.name)} <button class="text-btn" data-download="${safeText(t.id)}" data-kind="original" data-index="${i}">下載</button></div>`).join("");
    const processedName = t.processedFile?.name ? `<div class="file-name">成品：${safeText(t.processedFile.name)}</div>` : "";
    const attachments = (t.attachments || []).map((f,i) => `<div class="file-name">附件：${safeText(f.name)} <button class="text-btn" data-download="${safeText(t.id)}" data-kind="attachment" data-index="${i}">下載</button></div>`).join("");
    const actions = profile.role === "employee1"
      ? (t.processedFile ? `<button class="btn primary" data-download="${safeText(t.id)}" data-kind="processed">下載完成照片</button>` : `<span class="muted small">等待員工二處理並交回</span>`)
      : (t.status === "completed"
        ? `<span class="muted small">此工作已交回員工一</span>`
        : `<button class="btn secondary" data-download="${safeText(t.id)}" data-kind="original" ${t.originalFile ? "" : "disabled"}>下載原始照片</button>
           <button class="btn primary" data-process="${safeText(t.id)}">上傳完成照片</button>`);
    return `<article class="task">
      <div class="task-top"><div><h3>${safeText(t.title || "照片工作")}</h3><div class="task-meta">建立時間：${formatDate(t.createdAt)}</div></div><span class="status ${t.status}">${statusText}</span></div>
      ${t.note ? `<div class="task-note">${safeText(t.note)}</div>` : ""}
      ${originalName}${processedName}${attachments}
      <section class="handover-box">
        <h4>工作交接內容</h4>
        <textarea data-handover-text="${safeText(t.id)}" maxlength="4000" placeholder="輸入工作備註、交接文字……">${safeText(t.handoverText || "")}</textarea>
        <input data-handover-link="${safeText(t.id)}" type="url" maxlength="2000" placeholder="附上網址（選填）" value="${safeText(t.handoverLink || "")}">
        <div class="handover-actions"><label class="compact-file">新增附件（不佔照片名額）<input data-attachment="${safeText(t.id)}" type="file" multiple></label><button class="btn secondary" data-save-handover="${safeText(t.id)}">儲存文字／連結</button></div>
      </section>
      <div class="task-actions">${actions}</div>
    </article>`;
  }).join("");
  list.querySelectorAll("[data-download]").forEach(b => b.addEventListener("click", () => downloadTask(b.dataset.download,b.dataset.kind,Number(b.dataset.index || 0))));
  list.querySelectorAll("[data-save-handover]").forEach(b => b.addEventListener("click", () => saveHandover(b.dataset.saveHandover)));
  list.querySelectorAll("[data-attachment]").forEach(i => i.addEventListener("change", () => uploadAttachments(i.dataset.attachment, i.files)));
  list.querySelectorAll("[data-process]").forEach(b => b.addEventListener("click", () => chooseProcessed(b.dataset.process)));
}

const IMAGE_CHUNK_BYTES = 450 * 1024;

async function downloadTask(taskId, kind, index=0) {
  try {
    const task = taskMap.get(taskId);
    const meta = kind === "original" ? ((task?.originalFiles || (task?.originalFile ? [task.originalFile] : []))[index]) : kind === "attachment" ? task?.attachments?.[index] : task?.processedFile;
    if (!meta?.fileId || !meta?.chunkCount) throw new Error("找不到照片資料。");
    const snap = await getDocs(collection(db, "tasks", taskId, "files", kind, "uploads", meta.fileId, "chunks"));
    const docs = snap.docs.map(d => d.data()).sort((a, b) => a.index - b.index);
    if (docs.length !== meta.chunkCount) throw new Error("照片資料未完整同步，請重新整理後再試。");
    const parts = docs.map(item => {
      const binary = atob(item.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    });
    const blob = new Blob(parts, { type: meta.type || "image/webp" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = meta.name || "photoflow-image";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { console.error(e); notify(friendlyError(e)); }
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const toBlob = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
  let blob = await toBlob("image/webp", 0.80);
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", 0.82);
  if (!blob) throw new Error("照片壓縮失敗，請換一張照片再試。");
  if (blob.size > 8 * 1024 * 1024) blob = await toBlob(blob.type, 0.62);
  if (!blob || blob.size > 8 * 1024 * 1024) throw new Error("壓縮後照片仍超過 8MB，請選擇較小的照片。");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return { blob, name: `${file.name.replace(/\.[^.]+$/, "")}.${ext}`, type: blob.type };
}

async function uploadImageChunks(taskId, kind, file) {
  const prepared = await compressImage(file);
  const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
  const fileId = crypto.randomUUID();
  const total = Math.ceil(bytes.length / IMAGE_CHUNK_BYTES);
  const chunksRef = collection(db, "tasks", taskId, "files", kind, "uploads", fileId, "chunks");
  for (let index = 0; index < total; index++) {
    const slice = bytes.subarray(index * IMAGE_CHUNK_BYTES, Math.min((index + 1) * IMAGE_CHUNK_BYTES, bytes.length));
    let binary = "";
    for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
    await setDoc(doc(chunksRef, String(index).padStart(5, "0")), {
      index, data: btoa(binary), createdAt: serverTimestamp()
    });
  }
  return { fileId, chunkCount: total, name: prepared.name, type: prepared.type, size: prepared.blob.size };
}

async function createTask(event) {
  event.preventDefault(); showError("createError");
  const title = $("taskTitle").value.trim(), note = $("taskNote").value.trim(), files = [...$("originalImage").files];
  if (!title || !files.length) return showError("createError","請填寫工作名稱並選擇原始照片。");
  if (files.length > 20) return showError("createError","每個工作最多可選擇 20 張照片。");
  if (files.some(file => !["image/jpeg","image/png","image/webp"].includes(file.type))) return showError("createError","只支援 JPG、PNG 或 WEBP 圖片。");
  if (files.some(file => file.size > 25 * 1024 * 1024)) return showError("createError","單張照片不可超過 25MB。");
  if (!employee2Uid || employee2Uid.includes("PASTE_")) return showError("createError","請先在 firebase-config.js 設定員工二的 Firebase UID。");
  const btn = $("createBtn"); btn.disabled = true; btn.textContent = "正在上傳及傳送……";
  let taskRef;
  try {
    taskRef = await addDoc(collection(db,"tasks"), {
      title, note, createdBy: currentUser.uid, assignedTo: employee2Uid,
      status:"waiting", originalFile:null, originalFiles:[], processedFile:null, attachments:[], handoverText:"", handoverLink:"",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    const originalFiles = [];
    for (let i=0; i<files.length; i++) {
      btn.textContent = `正在上傳照片 ${i+1}/${files.length}……`;
      originalFiles.push(await uploadImageChunks(taskRef.id, "original", files[i]));
      await updateDoc(taskRef,{originalFiles:[...originalFiles],updatedAt:serverTimestamp()});
    }
    await updateDoc(taskRef,{originalFile:originalFiles[0] || null,updatedAt:serverTimestamp()});
    $("createForm").reset(); $("photoPreview").innerHTML=""; notify(`已上傳 ${originalFiles.length} 張原圖，工作已傳送。`);
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
      notify("正在壓縮及同步完成照片……");
      const processedFile = await uploadImageChunks(taskId, "processed", file);
      await updateDoc(taskRef,{
        processedFile,
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
function showPhotoSelection(files) {
  if(files.length>20) { $("originalImage").value=""; $("photoPreview").textContent="最多選擇 20 張照片。"; return; }
  if(files.some(f=>!f.type.startsWith("image/"))) { $("originalImage").value=""; $("photoPreview").textContent="請只選擇圖片檔案。"; return; }
  $("photoPreview").textContent=files.length ? `已選擇 ${files.length} 張照片：${files.map(f=>f.name).join("、")}` : "";
}
$("originalImage").addEventListener("change", () => showPhotoSelection([...$("originalImage").files]));
const drop = $("photoDrop");
["dragenter","dragover"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add("dragging");}));
["dragleave","drop"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove("dragging");}));
drop.addEventListener("drop",e=>{
  const files=[...e.dataTransfer.files];
  if(files.length>20 || files.some(f=>!f.type.startsWith("image/"))) { $("photoPreview").textContent="請拖放最多 20 張圖片，不要混入其他檔案。"; return; }
  const transfer=new DataTransfer(); files.forEach(f=>transfer.items.add(f)); $("originalImage").files=transfer.files; showPhotoSelection(files);
});

try { initFirebase(); }
catch(e) { showError("loginError",e.message); console.error(e); }
