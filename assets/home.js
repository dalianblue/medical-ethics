/* 首页双入口+设置弹窗 */
const $ = id => document.getElementById(id);
const KEY_LS = "me_deepseek_key";

$("btn-settings").onclick = () => {
  $("api-key-input").value = localStorage.getItem(KEY_LS) || "";
  $("settings-modal").hidden = false;
};
$("btn-cancel").onclick = () => { $("settings-modal").hidden = true; };
$("btn-save").onclick = () => {
  const k = $("api-key-input").value.trim();
  if (k) localStorage.setItem(KEY_LS, k);
  else localStorage.removeItem(KEY_LS);
  $("settings-modal").hidden = true;
  updateKeyHint();
};
function updateKeyHint() {
  const has = !!localStorage.getItem(KEY_LS);
  const chat = document.querySelector(".mode-card");
  chat.dataset.keyless = has ? "0" : "1";
}
updateKeyHint();
