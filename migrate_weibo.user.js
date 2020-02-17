// ==UserScript==
// @name         Migrate Weibo following
// @namespace    https://github.com/weiboMigration/migrateFollowingList
// @version      0.1
// @description  Migrate your weibo friends to the new account
// @author       Godfxxk Wang
// @match        https://m.weibo.cn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==



const stylesheet = `

.backup-controls-outer {
  height: 100px;
  padding: 2rem;
  display: flex;
}

.backup-controls-outer svg {
  fill: #eee;
  height: 100px;
  width: 100px;
  cursor: pointer;
}

.backup-controls-outer svg:hover {
  fill: #bbb;
}

.backup-controls-outer .backup-status {
  text-align: center;
  color: #eee;
  line-height: 100px;
  margin: 0 auto;
}

.migration-panel-btn {
  bottom: 7rem;
  color: coral;
  z-index: 999;
}

#weibo-migration-overlay {
  position: fixed;
  display: none;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  light: 0;
  bottom; 0;
  -webkit-backdrop-filter: blur(15px);
  backdrop-filter: blur(15px);
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}

#weibo-migration-overlay-inner {
  width: 80%;
  max-width: 600px;
  height: 100%;
  margin: 0 auto;
  overflow: scroll;
  background-color: rgba(64, 64, 64, 0.5);
}

#weibo-migration-overlay-inner .user-row {
  display: flex;
  line-height=1.5rem;
  font-size: 0.8rem;
  line-height: 2.6rem;
  padding: 0rem 0rem;
  border-color: #7f7f7f;
  border-width: 1px 0 0 0;
  border-style: solid;
}

#weibo-migration-overlay-inner .user-row a {
  padding: 0 0.5rem;
  color: #ddd;
  margin-left: 1.2rem;
}

#weibo-migration-overlay-inner .user-row .follow-btn {
  width: 120px;
  text-align: center;
  margin-left: auto;
  cursor: pointer;
  color: #ddd
}

#weibo-migration-overlay-inner .user-row .follow-btn:hover {
  cursor: pointer;
  background-color: rgba(255,255,255,0.1);
}

#weibo-migration-overlay-inner .user-row.followed .follow-btn {
  background-color: rgba(255,255,255,0.3);
  cursor: auto;
}
`;


/*
 *  Utils
 */

async function sleep(duration) { return new Promise(res => setTimeout(res, duration)); }

async function getElementsByClassNameAsync(e, max_retry = 5) {
  for (let attempt = 1; attempt < max_retry; ++attempt) {
    const elems = document.getElementsByClassName(e);
    if (elems.length > 0) return elems;
    await sleep(1000);
  }
  return [];
}

async function get_current_uid(max_retry = 10) {
  if (!has_login()) return 0;
  for (let attempt = 0; attempt < max_retry; ++attempt) {
    if (!config.uid) await sleep(1000);
  }
  return config.uid;
}

function has_login() {
  return typeof config.login !== 'undefined';
}

/*
 *  Weibo API
 */
async function fetch_following() {
  if (!has_login()) return [];

  const user_list = [];
  for (let i = 1;; ++i) {
    const req = await fetch(`https://m.weibo.cn/api/container/getIndex?containerid=231093_-_selffollowed&page=${i}`);
    const res = await req.json();

    // last page
    if (!res || res.ok === 0 && res.msg === '这里还没有内容') break;

    // check json
    if (!res.ok || !res.data || !res.data.cards) continue;
    const cards = res.data.cards || [];
    const card_group = cards[cards.length - 1].card_group || [];

    // get users
    user_list.push(...
      card_group.map(u => ({ uid: u.user.id, name: u.user.screen_name })));
  }
  return user_list;
}

async function follow_user(uid) {
  const req = await fetch('/api/friendships/create', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `uid=${uid}&st=${config.st}`
  });
  try {
    // TODO: handle error more friendly
    const res = await req.json();
    return res && res.ok === 1;
  } catch (e) {
    return false;
  }
}


/*
 *  UI State
 */
function set_status(str) {
  document.getElementById('backup-status').innerText = str;
}




/*
 *  Cache current following list (only refresh on login/logout)
 */
let background_updating = false;

async function background_fetch_current_following() {
  background_updating = true;
  const current_uid = await get_current_uid() || 0;
  const following = GM_getValue('weibo_current_following') || {};
  if (following.uid !== current_uid) {
    // clear cached following list if current uid changed
    GM_deleteValue('weibo_current_following');
    const following_list = await fetch_following();
    following.uid = current_uid;
    following.list = following_list;
    GM_setValue('weibo_current_following', following);
  }
  background_updating = false;
}

async function get_current_following() {
  // TODO: replace polling with promise
  while (background_updating) await sleep(200);
  return GM_getValue('weibo_current_following') || {uid: 0, list: []};
}

async function append_to_current_following(user_entry) {
  const following = await get_current_following();
  following.list.push(user_entry);
  GM_setValue('weibo_current_following', following);
}

function get_backup_following() {
  return GM_getValue('weibo_backup_following') || [];
}


/*
 *  UI Events
 */
async function do_backup() {
  if (get_backup_following().length &&
      !confirm('备份当前帐号的全部关注？这将覆盖已有备份'))
    return;

  GM_deleteValue('weibo_backup_following');
  await update_following_table();

  set_status('正在获取 ...');
  GM_setValue('weibo_backup_following', await fetch_following());
  await update_following_table();
}

async function do_follow(user, row_elem) {
  const success = await follow_user(user.uid);
  if (success) {
    row_elem.classList.add('followed');
    row_elem.getElementsByClassName('follow-btn')[0].innerText = '已关注';
    append_to_current_following(user);
  } else {
    alert('关注失败，请稍后再试');
  }
}

/*
 *  Make table of current following list
 */
async function update_following_table() {
  // clear all rows
  const overlay_inner = document.getElementById('weibo-migration-overlay-inner');
  Array.from(overlay_inner.getElementsByClassName('user-row'))
    .forEach(r => r.remove());

  const backup_following = get_backup_following();

  set_status('正在更新 ...');
  const current_following = await get_current_following();
  const current_following_set = new Set(current_following.list.map(u => u.uid));

  for (const u of backup_following) {
    const user_row = document.createElement('div');
    user_row.className = 'user-row';
    user_row.innerHTML = `<a href="/u/${u.uid}">${u.name}</a><div class="follow-btn"></div>`;
    if (current_following_set.has(u.uid)) {
      user_row.classList.add('followed');
      user_row.getElementsByClassName('follow-btn')[0].innerText = '已关注';
    } else {
      user_row.addEventListener('click', _ => do_follow(u, user_row));
      user_row.getElementsByClassName('follow-btn')[0].innerText = '关注';
    }
    overlay_inner.appendChild(user_row);
  }

  if (backup_following.length > 0) {
    set_status(`已备份 ${backup_following.length} 个关注`);
  } else {
    set_status(`点击按钮备份当前帐号的关注`);
  }
}


/*
 *  Construct overlay skeleton
 */
async function construct_button_and_overlay() {
  const overlay_name = 'weibo-migration-overlay';

  // construct wrapper
  const overlay = document.createElement('div');
  overlay.id = overlay_name;
  overlay.onclick = e => {
    if (e.target === e.currentTarget)
      document.getElementById(overlay_name).style.display = 'none';
  };

  // construct container
  const overlay_inner = document.createElement('div');
  overlay_inner.id = overlay_name + '-inner';

  const overlay_header = document.createElement('div');
  overlay_header.className = 'backup-controls-outer';

  const backup_btn = document.createElement('div');
  backup_btn.className = 'backup-btn';
  backup_btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">    <path d="M 15 1 C 14.448 1 14 1.448 14 2 L 14 6 L 16 6 L 16 2 C 16 1.448 15.552 1 15 1 z M 16 6 L 16 18.585938 L 18.292969 16.292969 C 18.683969 15.901969 19.316031 15.901969 19.707031 16.292969 C 20.098031 16.683969 20.098031 17.316031 19.707031 17.707031 L 15.707031 21.707031 C 15.512031 21.902031 15.256 22 15 22 C 14.744 22 14.487969 21.902031 14.292969 21.707031 L 10.292969 17.707031 C 9.9019687 17.316031 9.9019688 16.683969 10.292969 16.292969 C 10.683969 15.901969 11.316031 15.901969 11.707031 16.292969 L 14 18.585938 L 14 6 L 6 6 C 4.895 6 4 6.895 4 8 L 4 25 C 4 26.105 4.895 27 6 27 L 24 27 C 25.105 27 26 26.105 26 25 L 26 8 C 26 6.895 25.105 6 24 6 L 16 6 z"></path></svg>`;
  backup_btn.addEventListener('click', do_backup);

  const backup_status = document.createElement('div');
  backup_status.className = 'backup-status';
  backup_status.id = 'backup-status';

  overlay_header.appendChild(backup_btn);
  overlay_header.appendChild(backup_status);

  overlay_inner.appendChild(overlay_header);
  overlay.appendChild(overlay_inner);
  document.body.appendChild(overlay);

  // construct toggle button
  const toggle_btn = document.createElement('div');
  toggle_btn.className = 'refresh-btn migration-panel-btn';
  toggle_btn.innerText = '⇌';
  toggle_btn.onclick = _ => {
    document.getElementById(overlay_name).style.display = 'block';
    update_following_table();
  };
  const wrapper = await getElementsByClassNameAsync('m-container-max');
  wrapper[0].prepend(toggle_btn);

  // construct css
  const style = document.createElement('style');
  style.type = 'text/css';
  style.innerHTML = stylesheet;
  document.getElementsByTagName('head')[0].appendChild(style);
}

(async function () {
  'use strict';

  await construct_button_and_overlay();
  background_fetch_current_following();
})();