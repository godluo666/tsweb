import { icon } from './icons.js';

export function mountSettings(onConfig, notify) {
  for (const selector of ['.connect-logo', '.topbar']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button settings-button';
    button.title = '网站设置';
    button.setAttribute('aria-label', '网站设置');
    button.innerHTML = icon('settings');
    button.onclick = () => dialog.showModal();
    document.querySelector(selector).append(button);
  }
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="settings-dialog" aria-labelledby="settings-title">
      <div class="dialog-heading"><h2 id="settings-title">${icon('settings')}网站设置</h2><button type="button" class="icon-button" id="close-settings" aria-label="关闭设置">${icon('close')}</button></div>
      <form id="settings-login">
        <p>使用部署时显示的管理密码进入。</p>
        <label for="admin-password">管理密码</label><input id="admin-password" type="password" autocomplete="off" required>
        <button class="primary-button" type="submit">进入设置 ${icon('arrow')}</button>
      </form>
      <form id="settings-form" hidden>
        <label for="settings-name">网页名称</label><input id="settings-name" required maxlength="80" autocomplete="off">
        <label for="settings-password">网页访问密码</label><input id="settings-password" type="password" maxlength="256" autocomplete="new-password"><p class="field-hint">留空即可取消网页访问密码。</p>
        <label for="settings-security">TS 身份安全等级</label><input id="settings-security" type="number" min="8" max="20" step="1" required><p class="field-hint">默认 8，修改后用于后续连接。</p>
        <button class="primary-button" type="submit">保存设置</button>
      </form>
      <p id="settings-error" class="form-error" role="alert"></p>
    </dialog>`);
  const $ = selector => document.querySelector(selector);
  const dialog = $('#settings-dialog');
  let adminPassword = '';
  async function api(method, body) {
    const response = await fetch('/api/settings', {
      method,
      headers: { Authorization: `Bearer ${adminPassword}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '无法读取网站设置');
    return result;
  }
  $('#close-settings').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    adminPassword = '';
    $('#settings-login').reset();
    $('#settings-form').reset();
    $('#settings-login').hidden = false;
    $('#settings-form').hidden = true;
    $('#settings-error').textContent = '';
  });
  $('#settings-login').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $('#settings-error').textContent = '';
    adminPassword = $('#admin-password').value;
    try {
      const values = await api('GET');
      if (!dialog.open) return;
      $('#settings-name').value = values.siteName;
      $('#settings-password').value = values.webPassword;
      $('#settings-security').value = values.securityLevel;
      $('#settings-login').hidden = true;
      $('#settings-form').hidden = false;
      $('#admin-password').value = '';
      $('#settings-name').focus();
    } catch (error) { $('#settings-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('#settings-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $('#settings-error').textContent = '';
    try {
      const values = await api('PUT', { siteName: $('#settings-name').value, webPassword: $('#settings-password').value, securityLevel: Number($('#settings-security').value) });
      onConfig({ siteName: values.siteName, passwordRequired: Boolean(values.webPassword) });
      dialog.close();
      notify('网站设置已保存');
    } catch (error) { $('#settings-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
