(function () {
  'use strict';

  // 页面状态：用例列表、内置示例接口、请求头草稿行、最近一次响应结果与结果视图
  const state = {
    cases: [],
    selectedId: '',
    headers: [{ key: '', value: '' }],
    demos: [],
    busy: false,
    result: null,
    resultView: 'structured',
    filterText: '',
    importSession: null,
  };

  const dom = {
    health: document.getElementById('health-badge'),
    notice: document.getElementById('notice'),
    name: document.getElementById('field-name'),
    method: document.getElementById('field-method'),
    url: document.getElementById('field-url'),
    body: document.getElementById('field-body'),
    headerRows: document.getElementById('header-rows'),
    addHeader: document.getElementById('add-header'),
    demos: document.getElementById('demo-list'),
    demoSummary: document.getElementById('demo-summary'),
    sendRequest: document.getElementById('send-request'),
    saveCase: document.getElementById('save-case'),
    resetDraft: document.getElementById('reset-draft'),
    resultBody: document.getElementById('result-body'),
    resultSummary: document.getElementById('result-summary'),
    clearResult: document.getElementById('clear-result'),
    caseList: document.getElementById('case-list'),
    caseSummary: document.getElementById('case-summary'),
    refreshCases: document.getElementById('refresh-cases'),
    caseDetail: document.getElementById('case-detail'),
    closeDetail: document.getElementById('close-detail'),
    caseFilter: document.getElementById('case-filter-input'),
    caseFilterClear: document.getElementById('case-filter-clear'),
    exportButton: document.getElementById('export-cases'),
    importButton: document.getElementById('import-cases'),
    fileInput: document.getElementById('import-file-input'),
    exportModal: document.getElementById('export-modal'),
    exportCountHint: document.getElementById('export-count-hint'),
    exportScopeAll: document.getElementById('export-scope-all'),
    exportScopeVisible: document.getElementById('export-scope-visible'),
    exportConfirm: document.getElementById('export-confirm'),
    importModal: document.getElementById('import-modal'),
    importPickFile: document.getElementById('import-pick-file'),
    importFileName: document.getElementById('import-file-name'),
    importPreview: document.getElementById('import-preview'),
    importConfirm: document.getElementById('import-confirm'),
    importFootHint: document.getElementById('import-foot-hint'),
  };

  const emptyDetailHint = '在用例列表点「详情」，这里显示该用例保存下来的目标地址、请求头与请求内容。';
  // 结构化视图最多铺开的层级条目数量，避免内容过大时页面卡顿
  const TREE_LIMIT = 800;
  let noticeTimer = 0;

  // ---------------- 后端交互 ----------------

  // 统一请求入口：把服务端返回的错误码与出错位置打包进异常对象
  async function request(path, options) {
    const config = options || {};
    const init = { method: config.method || 'GET' };
    if (config.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(config.body);
    }

    let response = null;
    try {
      response = await fetch(path, init);
    } catch (err) {
      const error = new Error('无法连接服务，请确认服务已启动');
      error.code = 'NETWORK_ERROR';
      error.field = '';
      throw error;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = null;
    }

    if (!response.ok) {
      const info = (payload && payload.error) || {};
      const error = new Error(info.message || `操作失败（状态码 ${response.status}）`);
      error.code = info.code || 'request_failed';
      error.field = typeof info.field === 'string' ? info.field : '';
      throw error;
    }
    return payload;
  }

  function setBusy(busy, activeAction) {
    state.busy = busy;
    dom.sendRequest.disabled = busy;
    dom.saveCase.disabled = busy;
    dom.resetDraft.disabled = busy;
    dom.refreshCases.disabled = busy;
    dom.exportButton.disabled = busy;
    dom.importButton.disabled = busy;
    dom.sendRequest.textContent = busy && activeAction === 'send' ? '发送中…' : '发送请求';
    dom.saveCase.textContent = busy && activeAction === 'save' ? '正在保存…' : '保存为用例';
  }

  // ---------------- 页面消息与出错标记 ----------------

  function showNotice(message, type) {
    dom.notice.textContent = message;
    dom.notice.className = `notice notice-${type || 'info'}`;
    dom.notice.hidden = false;
    window.clearTimeout(noticeTimer);
    const stay = type === 'error' ? 6000 : 3500;
    noticeTimer = window.setTimeout(() => {
      dom.notice.hidden = true;
    }, stay);
  }

  function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach((node) => {
      node.hidden = true;
      node.textContent = '';
    });
    [dom.name, dom.url, dom.body, dom.headerRows].forEach((node) => node.classList.remove('invalid'));
  }

  // 服务端给出的位置可能是 headers.2.key 这种形式，标记时按区块归位
  function normalizeField(field) {
    if (typeof field !== 'string' || !field) return '';
    const key = field.split('.')[0];
    return ['name', 'method', 'url', 'headers', 'body'].includes(key) ? key : '';
  }

  function showFieldError(field, message) {
    const key = normalizeField(field);
    if (!key) return;
    const slot = document.querySelector(`[data-error="${key}"]`);
    if (slot) {
      slot.textContent = message;
      slot.hidden = false;
    }
    const target = {
      name: dom.name,
      method: dom.method,
      url: dom.url,
      headers: dom.headerRows,
      body: dom.body,
    }[key];
    if (target) target.classList.add('invalid');
  }

  // ---------------- 请求区 ----------------

  function renderHeaderRows() {
    dom.headerRows.textContent = '';
    if (!state.headers.length) {
      const empty = document.createElement('p');
      empty.className = 'rows-empty';
      empty.textContent = '暂无请求头';
      dom.headerRows.appendChild(empty);
      return;
    }

    state.headers.forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'header-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'header-key';
      keyInput.value = row.key;
      keyInput.autocomplete = 'off';
      keyInput.dataset.index = String(index);
      keyInput.dataset.part = 'key';
      keyInput.setAttribute('aria-label', `第 ${index + 1} 行请求头名称`);

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'header-value';
      valueInput.value = row.value;
      valueInput.autocomplete = 'off';
      valueInput.dataset.index = String(index);
      valueInput.dataset.part = 'value';
      valueInput.setAttribute('aria-label', `第 ${index + 1} 行请求头取值`);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-small';
      remove.textContent = '删除';
      remove.dataset.action = 'remove-header';
      remove.dataset.index = String(index);

      line.append(keyInput, valueInput, remove);
      dom.headerRows.appendChild(line);
    });
  }

  function collectDraft() {
    return {
      name: dom.name.value.trim(),
      method: dom.method.value,
      url: dom.url.value.trim(),
      headers: state.headers.map((row) => ({ key: row.key.trim(), value: row.value })),
      body: dom.body.value,
    };
  }

  // 把一份请求内容写回表单，既用于示例接口填入，也用于用例回填
  function fillDraft(draft) {
    dom.name.value = typeof draft.name === 'string' ? draft.name : '';
    dom.method.value = draft.method || 'GET';
    dom.url.value = draft.url || '';
    dom.body.value = typeof draft.body === 'string' ? draft.body : '';
    state.headers = Array.isArray(draft.headers) && draft.headers.length
      ? draft.headers.map((row) => ({
          key: typeof row.key === 'string' ? row.key : '',
          value: typeof row.value === 'string' ? row.value : '',
        }))
      : [{ key: '', value: '' }];
    renderHeaderRows();
    clearFieldErrors();
  }

  function resetDraft(silent) {
    fillDraft({ name: '', method: 'GET', url: '', headers: [], body: '' });
    if (!silent) showNotice('草稿已清空', 'info');
  }

  // ---------------- 内置示例接口 ----------------

  async function loadDemos() {
    try {
      const data = await request('/api/demos');
      state.demos = data && Array.isArray(data.endpoints) ? data.endpoints : [];
    } catch (err) {
      state.demos = [];
    }
    renderDemos();
  }

  function renderDemos() {
    dom.demos.textContent = '';
    if (!state.demos.length) {
      dom.demoSummary.textContent = '读取失败';
      const hint = document.createElement('p');
      hint.className = 'rows-empty';
      hint.textContent = '内置示例接口暂时读取不到，可以直接在目标地址里填写完整地址';
      dom.demos.appendChild(hint);
      return;
    }

    dom.demoSummary.textContent = `共 ${state.demos.length} 个`;
    state.demos.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'demo-item';

      const main = document.createElement('div');
      main.className = 'demo-main';

      const title = document.createElement('div');
      title.className = 'demo-title';
      const nameNode = document.createElement('span');
      nameNode.className = 'demo-name';
      nameNode.textContent = item.name;
      title.append(nameNode, buildTag(item.method, item.method === 'GET' ? 'get' : 'any'));

      const pathNode = document.createElement('p');
      pathNode.className = 'demo-path';
      pathNode.textContent = item.path;

      const summaryNode = document.createElement('p');
      summaryNode.className = 'demo-summary';
      summaryNode.textContent = item.summary;

      main.append(title, pathNode, summaryNode);

      const fill = document.createElement('button');
      fill.type = 'button';
      fill.className = 'btn btn-small';
      fill.textContent = '填入请求区';
      fill.addEventListener('click', () => {
        fillDraft(item.example);
        state.selectedId = '';
        renderCases();
        showNotice(`已把「${item.name}」填入请求区，点发送请求即可看到结果`, 'info');
      });

      row.append(main, fill);
      dom.demos.appendChild(row);
    });
  }

  // ---------------- 发送请求与结果展示 ----------------

  async function sendRequest() {
    if (state.busy) return;
    clearFieldErrors();

    const draft = collectDraft();
    if (!draft.url) {
      showFieldError('url', '请填写目标地址');
      showNotice('请填写目标地址', 'error');
      dom.url.focus();
      return;
    }
    if (draft.body.trim() && (draft.method === 'GET' || draft.method === 'HEAD')) {
      showFieldError('body', `请求方式为 ${draft.method} 时不带请求内容，请清空请求内容或更换请求方式`);
      showNotice('请求方式与请求内容不匹配，请调整后再发送', 'error');
      return;
    }

    setBusy(true, 'send');
    renderResultPending(draft);
    try {
      const result = await request('/api/send', { method: 'POST', body: draft });
      state.result = result;
      renderResult(result);
      if (result.ok) {
        showNotice(`请求已完成：状态码 ${result.status}，耗时 ${formatDuration(result.timeMs)}`, 'success');
      } else {
        showNotice(`请求失败：${result.failure.reason}`, 'error');
      }
    } catch (err) {
      state.result = null;
      if (err.field) showFieldError(err.field, err.message);
      dom.resultSummary.textContent = '';
      dom.resultBody.textContent = '';
      dom.clearResult.hidden = false;
      dom.resultBody.appendChild(buildFailurePanel('这次请求没有发出去', err.message, ''));
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderResultPending(draft) {
    dom.resultSummary.textContent = '正在等待响应';
    dom.clearResult.hidden = true;
    dom.resultBody.textContent = '';

    const block = document.createElement('div');
    block.className = 'result-pending';
    const title = document.createElement('p');
    title.className = 'pending-title';
    title.textContent = '请求已发出，正在等待响应…';
    const sub = document.createElement('p');
    sub.className = 'empty-sub';
    sub.textContent = `${draft.method} ${draft.url} 已按照填写的内容发出去，收到回应后这里会显示状态、耗时、响应头与响应内容。`;
    block.append(title, sub);
    dom.resultBody.appendChild(block);
  }

  function renderEmptyResult() {
    dom.resultSummary.textContent = '';
    dom.clearResult.hidden = true;
    dom.resultBody.textContent = '';
    dom.resultBody.appendChild(
      buildEmptyBlock(
        '还没有发送过请求',
        '填好请求方式与目标地址后点「发送请求」，这里会显示响应状态、耗时、响应头与响应内容。'
      )
    );
  }

  function renderResult(result) {
    dom.resultBody.textContent = '';
    dom.clearResult.hidden = false;

    const head = document.createElement('div');
    head.className = 'result-head';

    if (result.ok) {
      head.appendChild(buildStatusBadge(result.status, result.statusText));
      head.appendChild(buildChip(`耗时 ${formatDuration(result.timeMs)}`));
      head.appendChild(buildChip(`内容 ${formatBytes(result.size)}`));
      // 状态码落在 400 及以上时，页面同样按失败口径提醒
      if (result.status >= 400) head.appendChild(buildChip('本次响应为失败状态', 'chip-bad'));
      dom.resultSummary.textContent = `最近一次：${result.status} ${result.statusText}`.trim();
    } else {
      head.appendChild(buildStatusBadge(0, '未完成'));
      head.appendChild(buildChip(`已等待 ${formatDuration(result.timeMs)}`));
      dom.resultSummary.textContent = '最近一次：请求未完成';
    }
    dom.resultBody.appendChild(head);

    const targetLine = document.createElement('p');
    targetLine.className = 'result-target';
    targetLine.textContent = result.internal
      ? `目标地址（本机内置示例接口）：${result.targetUrl}`
      : `目标地址：${result.targetUrl}`;
    dom.resultBody.appendChild(targetLine);

    if (!result.ok) {
      dom.resultBody.appendChild(
        buildFailurePanel('请求没有完成', result.failure.reason, result.failure.detail)
      );
      return;
    }

    const headerSection = buildSection('响应头');
    if (result.headers.length) {
      headerSection.appendChild(buildHeaderTable(result.headers));
    } else {
      headerSection.appendChild(buildTextNote('本次响应没有返回响应头'));
    }
    dom.resultBody.appendChild(headerSection);

    const bodySection = buildSection('响应内容');
    bodySection.appendChild(buildBodyView(result));
    dom.resultBody.appendChild(bodySection);
  }

  function buildFailurePanel(title, reason, detail) {
    const panel = document.createElement('div');
    panel.className = 'failure-panel';

    const titleNode = document.createElement('p');
    titleNode.className = 'failure-title';
    titleNode.textContent = title;

    const reasonNode = document.createElement('p');
    reasonNode.className = 'failure-reason';
    reasonNode.textContent = `失败原因：${reason}`;

    panel.append(titleNode, reasonNode);

    if (detail) {
      const detailNode = document.createElement('p');
      detailNode.className = 'failure-detail';
      detailNode.textContent = `详细信息：${detail}`;
      panel.appendChild(detailNode);
    }
    return panel;
  }

  function buildBodyView(result) {
    const wrap = document.createElement('div');
    wrap.className = 'body-view';

    const text = typeof result.body === 'string' ? result.body : '';
    if (!text.trim()) {
      wrap.appendChild(buildTextNote(result.status === 204 ? '本次响应为成功且没有返回内容' : '本次响应没有返回内容'));
      return wrap;
    }

    const tabs = document.createElement('div');
    tabs.className = 'view-tabs';
    tabs.append(
      buildTab('结构化', state.resultView === 'structured', () => switchResultView('structured')),
      buildTab('原始文本', state.resultView === 'raw', () => switchResultView('raw'))
    );
    wrap.appendChild(tabs);

    const parsed = tryParseJson(text);
    if (state.resultView === 'raw') {
      wrap.appendChild(buildPre(text));
    } else if (parsed.ok) {
      wrap.appendChild(buildJsonTree(parsed.value, '', { left: TREE_LIMIT }));
    } else {
      wrap.appendChild(buildTextNote('响应内容不是结构化数据，已按文本显示'));
      wrap.appendChild(buildPre(text));
    }

    if (result.truncated) {
      wrap.appendChild(buildTextNote('响应内容较大，这里只保留了开头的一部分用于展示'));
    }
    return wrap;
  }

  function switchResultView(view) {
    state.resultView = view;
    if (state.result) renderResult(state.result);
  }

  function tryParseJson(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return { ok: false, value: null };
    }
  }

  function buildPre(text) {
    const pre = document.createElement('pre');
    pre.className = 'result-pre';
    pre.textContent = text;
    return pre;
  }

  // 结构化视图：对象与数组逐层铺开，取值按类型区分显示
  function buildJsonTree(value, label, counter) {
    counter.left -= 1;
    const node = document.createElement('div');
    node.className = 'json-node';

    if (value !== null && typeof value === 'object') {
      const isArray = Array.isArray(value);
      const keys = isArray ? value.map((_, index) => index) : Object.keys(value);

      const head = document.createElement('div');
      head.className = 'json-line';
      head.appendChild(buildJsonKey(label));
      head.appendChild(buildJsonTag(`${isArray ? '数组' : '对象'} ${keys.length} 项`));
      node.appendChild(head);

      const children = document.createElement('div');
      children.className = 'json-children';

      if (!keys.length) {
        children.appendChild(buildJsonLine('', isArray ? '空数组' : '空对象', 'empty'));
      } else {
        let shown = 0;
        for (let index = 0; index < keys.length; index += 1) {
          if (counter.left <= 0) break;
          const key = keys[index];
          children.appendChild(
            buildJsonTree(value[key], isArray ? `[${key}]` : String(key), counter)
          );
          shown += 1;
        }
        if (shown < keys.length) {
          children.appendChild(buildTextNote(`还有 ${keys.length - shown} 项未展开，可切换到原始文本查看完整内容`));
        }
      }

      node.appendChild(children);
      return node;
    }

    node.appendChild(buildJsonLine(label, describePrimitive(value), primitiveKind(value)));
    return node;
  }

  function buildJsonLine(label, text, kind) {
    const line = document.createElement('div');
    line.className = 'json-line';
    if (label) line.appendChild(buildJsonKey(label));
    const valueNode = document.createElement('span');
    valueNode.className = `json-value json-${kind}`;
    valueNode.textContent = text;
    line.appendChild(valueNode);
    return line;
  }

  function buildJsonKey(label) {
    const key = document.createElement('span');
    key.className = 'json-key';
    key.textContent = label || '整体内容';
    return key;
  }

  function buildJsonTag(text) {
    const tag = document.createElement('span');
    tag.className = 'json-tag';
    tag.textContent = text;
    return tag;
  }

  function describePrimitive(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
  }

  function primitiveKind(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
  }

  // ---------------- 用例区 ----------------

  async function loadCases() {
    const list = await request('/api/cases');
    state.cases = Array.isArray(list) ? list : [];
    if (state.selectedId && !state.cases.some((item) => item.id === state.selectedId)) {
      state.selectedId = '';
    }
    renderCases();
  }

  // 当前可见的用例：筛选框为空时即全部用例；导出、列表渲染都以它为准
  function getVisibleCases() {
    const keyword = state.filterText.trim().toLowerCase();
    if (!keyword) return state.cases;
    return state.cases.filter((item) => {
      const name = String(item.name || '').toLowerCase();
      const url = String(item.url || '').toLowerCase();
      return name.includes(keyword) || url.includes(keyword);
    });
  }

  function renderCases() {
    const visible = getVisibleCases();
    dom.caseSummary.textContent = state.filterText.trim()
      ? `可见 ${visible.length} / 共 ${state.cases.length} 条`
      : `共 ${state.cases.length} 条`;
    dom.caseFilterClear.hidden = !state.filterText;
    dom.caseList.textContent = '';

    if (!state.cases.length) {
      dom.caseList.appendChild(
        buildEmptyBlock('还没有保存过用例', '在请求区填好内容后点「保存为用例」，用例会出现在这里。')
      );
      return;
    }
    if (!visible.length) {
      dom.caseList.appendChild(
        buildEmptyBlock('没有符合筛选条件的用例', '换个关键词试试，或点「清除筛选」查看全部用例。')
      );
      return;
    }
    visible.forEach((item) => {
      dom.caseList.appendChild(buildCaseRow(item));
    });
  }

  function buildEmptyBlock(title, subtitle) {
    const block = document.createElement('div');
    block.className = 'empty';
    const titleNode = document.createElement('p');
    titleNode.className = 'empty-title';
    titleNode.textContent = title;
    const subNode = document.createElement('p');
    subNode.className = 'empty-sub';
    subNode.textContent = subtitle;
    block.append(titleNode, subNode);
    return block;
  }

  function buildTextNote(text) {
    const note = document.createElement('p');
    note.className = 'text-note';
    note.textContent = text;
    return note;
  }

  function buildTag(text, kind) {
    const tag = document.createElement('span');
    tag.className = `method method-${kind || 'any'}`;
    tag.textContent = text;
    return tag;
  }

  function buildCaseRow(item) {
    const row = document.createElement('article');
    row.className = 'case-item';
    if (item.id === state.selectedId) row.classList.add('active');

    const main = document.createElement('div');
    main.className = 'case-main';

    const title = document.createElement('div');
    title.className = 'case-title';
    const nameNode = document.createElement('span');
    nameNode.className = 'case-name';
    nameNode.textContent = item.name;
    title.append(buildTag(item.method, String(item.method).toLowerCase()), nameNode);
    if (item.url.startsWith('/')) title.appendChild(buildTag('内置', 'inner'));

    const urlNode = document.createElement('p');
    urlNode.className = 'case-url';
    urlNode.textContent = item.url;

    const metaNode = document.createElement('p');
    metaNode.className = 'case-meta';
    metaNode.textContent = `请求头 ${item.headers.length} 行 · 保存于 ${formatTime(item.createdAt)}`;

    main.append(title, urlNode, metaNode);

    const actions = document.createElement('div');
    actions.className = 'case-actions';

    const fillButton = document.createElement('button');
    fillButton.type = 'button';
    fillButton.className = 'btn btn-small';
    fillButton.textContent = '回填';
    fillButton.addEventListener('click', () => {
      applyCase(item);
    });

    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.className = 'btn btn-small';
    viewButton.textContent = '详情';
    viewButton.addEventListener('click', () => {
      openDetail(item.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-small btn-danger';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      removeCase(item);
    });

    actions.append(fillButton, viewButton, deleteButton);
    row.append(main, actions);
    return row;
  }

  // 回填：把用例保存下来的内容写回请求区，可以直接点发送请求重发一次
  function applyCase(item) {
    if (state.busy) return;
    fillDraft(item);
    state.selectedId = item.id;
    renderCases();
    renderDetail(item);
    showNotice(`用例「${item.name}」已回填到请求区，可直接点发送请求`, 'success');
  }

  async function openDetail(id) {
    if (state.busy) return;
    try {
      const item = await request(`/api/cases/${encodeURIComponent(id)}`);
      state.selectedId = item.id;
      renderCases();
      renderDetail(item);
    } catch (err) {
      showNotice(err.message, 'error');
      if (err.code === 'CASE_NOT_FOUND') {
        state.selectedId = '';
        renderEmptyDetail();
        try {
          await loadCases();
        } catch (reloadError) {
          showNotice(reloadError.message, 'error');
        }
      }
    }
  }

  function renderDetail(item) {
    dom.caseDetail.textContent = '';

    const head = document.createElement('div');
    head.className = 'detail-head';
    const nameNode = document.createElement('h3');
    nameNode.textContent = item.name;
    head.append(buildTag(item.method, String(item.method).toLowerCase()), nameNode);

    const fillButton = document.createElement('button');
    fillButton.type = 'button';
    fillButton.className = 'btn btn-small';
    fillButton.textContent = '回填到请求区';
    fillButton.addEventListener('click', () => {
      applyCase(item);
    });
    head.appendChild(fillButton);

    dom.caseDetail.append(head);
    dom.caseDetail.append(buildDetailRow('目标地址', item.url, false));
    dom.caseDetail.append(
      buildDetailRow(
        '请求头',
        item.headers.length ? item.headers.map((row) => `${row.key}: ${row.value}`).join('\n') : '暂无内容',
        true
      )
    );
    dom.caseDetail.append(buildDetailRow('请求内容', item.body || '暂无内容', true));
    dom.caseDetail.append(
      buildDetailRow('保存时间', `${formatTime(item.createdAt)}（最近更新 ${formatTime(item.updatedAt)}）`, false)
    );
    dom.closeDetail.hidden = false;
  }

  function buildDetailRow(label, text, block) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-row';

    const labelNode = document.createElement('span');
    labelNode.className = 'detail-label';
    labelNode.textContent = label;

    const valueNode = document.createElement(block ? 'pre' : 'p');
    valueNode.className = 'detail-value';
    valueNode.textContent = text;

    wrap.append(labelNode, valueNode);
    return wrap;
  }

  function renderEmptyDetail() {
    dom.closeDetail.hidden = true;
    dom.caseDetail.textContent = '';
    const subNode = document.createElement('p');
    subNode.className = 'empty-sub';
    subNode.textContent = emptyDetailHint;
    dom.caseDetail.appendChild(subNode);
  }

  // ---------------- 保存与删除 ----------------

  async function saveCase() {
    if (state.busy) return;
    clearFieldErrors();

    const draft = collectDraft();
    if (!draft.name) {
      showFieldError('name', '请填写用例名称');
      showNotice('请填写用例名称', 'error');
      dom.name.focus();
      return;
    }
    if (!draft.url) {
      showFieldError('url', '请填写目标地址');
      showNotice('请填写目标地址', 'error');
      dom.url.focus();
      return;
    }

    setBusy(true, 'save');
    try {
      const created = await request('/api/cases', { method: 'POST', body: draft });
      state.selectedId = created.id;
      await loadCases();
      renderDetail(created);
      showNotice(`用例「${created.name}」已保存，请求区内容保留可直接发送`, 'success');
    } catch (err) {
      if (err.field) showFieldError(err.field, err.message);
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeCase(item) {
    if (state.busy) return;
    const confirmed = window.confirm(`确认删除用例「${item.name}」？删除后无法恢复。`);
    if (!confirmed) return;

    setBusy(true);
    try {
      await request(`/api/cases/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (state.selectedId === item.id) state.selectedId = '';
      await loadCases();
      if (!state.selectedId) renderEmptyDetail();
      showNotice(`用例「${item.name}」已删除`, 'success');
    } catch (err) {
      showNotice(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------------- 导出与导入 ----------------

  function openModal(node) {
    node.hidden = false;
  }

  function closeModal(node) {
    node.hidden = true;
  }

  // 导出只带走与用例内容有关的字段，编号与保存时间由导入方重新生成
  function serializeCase(item) {
    return {
      name: item.name,
      method: item.method,
      url: item.url,
      headers: Array.isArray(item.headers) ? item.headers : [],
      body: typeof item.body === 'string' ? item.body : '',
    };
  }

  function formatFileTime(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
      `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
  }

  function openExportModal() {
    if (!state.cases.length) {
      // 一条都没有时明确说明，不生成任何文件
      showNotice('当前一条用例都没有，没有可导出的内容，未生成导出文件', 'error');
      return;
    }
    const visible = getVisibleCases();
    dom.exportScopeAll.textContent = `共 ${state.cases.length} 条`;
    dom.exportScopeVisible.textContent = visible.length
      ? `当前可见 ${visible.length} 条`
      : '当前没有可见用例（筛选无结果）';
    const visibleRadio = dom.exportModal.querySelector('input[value="visible"]');
    visibleRadio.disabled = visible.length === 0;
    dom.exportModal.querySelector('input[value="all"]').checked = true;
    updateExportConfirm();
    openModal(dom.exportModal);
  }

  function getExportScope() {
    const checked = dom.exportModal.querySelector('input[name="export-scope"]:checked');
    return checked ? checked.value : 'all';
  }

  function updateExportConfirm() {
    const scope = getExportScope();
    const count = scope === 'visible' ? getVisibleCases().length : state.cases.length;
    dom.exportConfirm.disabled = count === 0;
    dom.exportCountHint.textContent = count
      ? `本次将导出 ${count} 条用例（${scope === 'visible' ? '仅当前可见' : '全部用例'}）。`
      : '当前可见用例为 0 条，请改选「导出全部用例」或调整筛选条件。';
  }

  function confirmExport() {
    const scope = getExportScope();
    const cases = scope === 'visible' ? getVisibleCases() : state.cases;
    if (!cases.length) {
      showNotice('所选范围内一条用例都没有，未生成导出文件', 'error');
      return;
    }

    const exportedAt = new Date().toISOString();
    const fileContent = {
      format: 'api-workbench-cases',
      version: 1,
      exportedAt,
      count: cases.length,
      cases: cases.map(serializeCase),
    };
    const blob = new Blob([`${JSON.stringify(fileContent, null, 2)}\n`], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cases-export-${formatFileTime(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    closeModal(dom.exportModal);
    showNotice(
      `已导出 ${cases.length} 条用例（${scope === 'visible' ? '仅当前可见' : '全部用例'}），文件「${link.download}」已开始下载，请在浏览器下载记录中取走`,
      'success'
    );
  }

  // ---- 导入：选文件 → 预览体检 → 逐条决策 → 提交 ----

  function resetImportSession(extra) {
    state.importSession = Object.assign(
      {
        stage: 'empty', // empty | reading | preview | read-error | preview-error | committing | done
        fileName: '',
        rawList: [],
        items: [],
        existingNames: new Set(),
        message: '',
        result: null,
      },
      extra || {}
    );
  }

  function openImportModal() {
    dom.fileInput.value = '';
    resetImportSession();
    renderImportPreview();
    openModal(dom.importModal);
  }

  async function handleImportFile(file) {
    resetImportSession({ stage: 'reading', fileName: file.name });
    renderImportPreview();

    let parsed = null;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      resetImportSession({
        stage: 'read-error',
        fileName: file.name,
        message: '文件内容不是合法的 JSON，无法作为用例导出文件读取，请重新选择文件。',
      });
      renderImportPreview();
      showNotice('导入文件解析失败：内容不是合法的 JSON', 'error');
      return;
    }

    try {
      const preview = await request('/api/import/preview', { method: 'POST', body: parsed });
      const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cases) ? parsed.cases : [];
      const existingNames = new Set();
      const seenInFile = new Set();
      const items = (preview.items || []).map((item) => {
        if (item.exists) existingNames.add(item.name);
        let decision;
        if (!item.valid) {
          decision = { mode: 'skip', targetId: '', saveAsName: '' };
        } else if (item.exists) {
          decision = { mode: 'overwrite', targetId: item.existing[0] ? item.existing[0].id : '', saveAsName: '' };
        } else if (!seenInFile.has(item.name)) {
          seenInFile.add(item.name);
          decision = { mode: 'create', targetId: '', saveAsName: '' };
        } else {
          // 文件内同名、库里又不存在的多条用例，从第二条起预填一个改名建议，避免直接撞名
          const saveAsName = suggestSaveAsName(item.name, new Set([...existingNames, ...seenInFile]), new Set());
          seenInFile.add(saveAsName);
          decision = { mode: 'create', targetId: '', saveAsName };
        }
        return Object.assign({}, item, { decision });
      });
      resetImportSession({
        stage: 'preview',
        fileName: file.name,
        rawList,
        items,
        existingNames,
      });
      renderImportPreview();
      showNotice(`已读取「${file.name}」：共 ${items.length} 条，请在预览中确认每条的处理方式`, 'info');
    } catch (err) {
      resetImportSession({
        stage: 'preview-error',
        fileName: file.name,
        message: err.message || '导入预览失败，请稍后重试',
      });
      renderImportPreview();
      showNotice(err.message || '导入预览失败', 'error');
    }
  }

  // 为「另存为新用例」预填一个不与现有用例冲突的名字
  function suggestSaveAsName(name, existingNames, usedSaveAsNames) {
    const base = `${name}（导入副本）`;
    let candidate = base;
    let suffix = 2;
    while (existingNames.has(candidate) || usedSaveAsNames.has(candidate)) {
      candidate = `${name}（导入副本 ${suffix}）`;
      suffix += 1;
    }
    return candidate;
  }

  // 汇总当前每条选择对应的处理结果与名称冲突，预览头部、底部与行内标记都用它
  function evaluateImportPlan() {
    const session = state.importSession;
    const claimed = new Set(session.existingNames);
    const plan = session.items.map((item) => {
      const mode = item.decision.mode;
      // 重名条目选覆盖时沿用库中名称；新建时优先使用另存为栏里的名字
      let effectiveName = item.name;
      if (mode === 'create') effectiveName = item.decision.saveAsName.trim() || item.name;
      return { item, mode, effectiveName, conflict: '' };
    });

    // 第一遍只看库里已有与本次要新建的名字，第二遍把同批新建之间的重名也标出来
    plan.forEach((row) => {
      if (row.mode !== 'create') return;
      if (!row.effectiveName.trim()) {
        if (row.item.exists) row.conflict = '请填写另存为的新用例名称';
        return;
      }
      if (claimed.has(row.effectiveName)) {
        row.conflict = '该名称已被现有用例或本次其他导入条目占用';
      } else {
        claimed.add(row.effectiveName);
      }
    });
    const secondClaimed = new Set();
    plan.forEach((row) => {
      if (row.mode !== 'create' || !row.effectiveName) return;
      if (!row.conflict && secondClaimed.has(row.effectiveName)) {
        row.conflict = '与本次导入的另一条新建用例重名';
      }
      secondClaimed.add(row.effectiveName);
    });

    const stats = { create: 0, overwrite: 0, skip: 0, conflicts: 0 };
    plan.forEach((row) => {
      stats[row.mode] += 1;
      if (row.conflict) stats.conflicts += 1;
    });
    return { plan, stats };
  }

  function setImportDecision(index, patch) {
    const session = state.importSession;
    const item = session.items[index];
    if (!item) return;
    Object.assign(item.decision, patch);
    if (patch.mode === 'create' && item.exists && !item.decision.saveAsName) {
      const used = new Set();
      session.items.forEach((other, otherIndex) => {
        if (otherIndex !== index && other.exists && other.decision.mode === 'create' && other.decision.saveAsName) {
          used.add(other.decision.saveAsName.trim());
        }
      });
      item.decision.saveAsName = suggestSaveAsName(item.name, session.existingNames, used);
    }
    renderImportPreview();
  }

  function batchSetExisting(mode) {
    const session = state.importSession;
    session.items.forEach((item) => {
      if (!item.exists || !item.valid) return;
      item.decision.mode = mode;
      item.decision.targetId = item.existing[0] ? item.existing[0].id : '';
    });
    renderImportPreview();
  }

  function resetImportDecisions() {
    const session = state.importSession;
    session.items.forEach((item) => {
      if (!item.valid) {
        item.decision = { mode: 'skip', targetId: '', saveAsName: '' };
      } else if (item.exists) {
        item.decision = { mode: 'overwrite', targetId: item.existing[0] ? item.existing[0].id : '', saveAsName: '' };
      } else {
        item.decision = { mode: 'create', targetId: '', saveAsName: '' };
      }
    });
    renderImportPreview();
  }

  function renderImportPreview() {
    const session = state.importSession;
    dom.importPreview.textContent = '';
    dom.importFileName.textContent = session.fileName ? `已选择文件：${session.fileName}` : '尚未选择文件';

    if (session.stage === 'empty') {
      dom.importConfirm.disabled = true;
      dom.importFootHint.textContent = '';
      dom.importPreview.appendChild(
        buildEmptyBlock('还没有选择文件', '点「选择文件」挑一份此前导出的 JSON 文件，导入内容会先在这里预览，不会直接落库。')
      );
      return;
    }
    if (session.stage === 'reading') {
      dom.importConfirm.disabled = true;
      dom.importFootHint.textContent = '';
      const pending = document.createElement('div');
      pending.className = 'import-progress';
      pending.textContent = '正在读取并检查文件内容…';
      dom.importPreview.appendChild(pending);
      return;
    }
    if (session.stage === 'read-error' || session.stage === 'preview-error') {
      dom.importConfirm.disabled = true;
      dom.importFootHint.textContent = '';
      dom.importPreview.appendChild(buildFailurePanel('文件无法导入', session.message, ''));
      return;
    }
    if (session.stage === 'committing') {
      dom.importConfirm.disabled = true;
      dom.importFootHint.textContent = '正在写入用例库…';
      const pending = document.createElement('div');
      pending.className = 'import-progress';
      pending.textContent = '正在按预览中的选择导入，请稍候…';
      dom.importPreview.appendChild(pending);
      return;
    }
    if (session.stage === 'done') {
      dom.importConfirm.disabled = true;
      renderImportResult(session.result);
      return;
    }

    renderImportPlan(session);
  }

  function renderImportPlan(session) {
    const { plan, stats } = evaluateImportPlan();
    const validCount = session.items.filter((item) => item.valid).length;
    const invalidCount = session.items.length - validCount;
    const existsCount = session.items.filter((item) => item.exists).length;
    const dupFileCount = session.items.filter((item) => item.duplicateInFile).length;

    const summary = document.createElement('div');
    summary.className = 'import-summary';
    summary.appendChild(buildImportChip(`文件内共 ${session.items.length} 条`));
    summary.appendChild(buildImportChip(`名称已存在 ${existsCount} 条`, existsCount ? 'chip-warn' : ''));
    summary.appendChild(buildImportChip(`文件内重名 ${dupFileCount} 条`, dupFileCount ? 'chip-info' : ''));
    summary.appendChild(buildImportChip(`内容不成立 ${invalidCount} 条`, invalidCount ? 'chip-bad' : ''));
    dom.importPreview.appendChild(summary);

    if (existsCount) {
      const batch = document.createElement('div');
      batch.className = 'import-batch';
      const hint = buildTextNote('对名称已存在的用例批量选择：');
      const allOverwrite = document.createElement('button');
      allOverwrite.type = 'button';
      allOverwrite.className = 'btn btn-small';
      allOverwrite.textContent = '全部覆盖';
      allOverwrite.addEventListener('click', () => batchSetExisting('overwrite'));
      const allSkip = document.createElement('button');
      allSkip.type = 'button';
      allSkip.className = 'btn btn-small';
      allSkip.textContent = '全部跳过';
      allSkip.addEventListener('click', () => batchSetExisting('skip'));
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn btn-ghost btn-small';
      reset.textContent = '恢复默认';
      reset.addEventListener('click', resetImportDecisions);
      batch.append(hint, allOverwrite, allSkip, reset);
      dom.importPreview.appendChild(batch);
    }

    if (!session.items.length) {
      dom.importPreview.appendChild(
        buildEmptyBlock('文件里一条用例都没有', '这份文件不包含任何用例，请确认选择的是完整的用例导出文件。')
      );
      dom.importConfirm.disabled = true;
      dom.importFootHint.textContent = '没有可导入的内容';
      return;
    }

    const list = document.createElement('div');
    list.className = 'import-list';
    plan.forEach((row) => list.appendChild(buildImportItem(row)));
    dom.importPreview.appendChild(list);

    const nothingToDo = stats.create + stats.overwrite === 0;
    dom.importConfirm.disabled = stats.conflicts > 0 || nothingToDo;
    if (stats.conflicts > 0) {
      dom.importFootHint.textContent = `有 ${stats.conflicts} 条「另存为新用例」的名称为空或重名，请改名后再导入`;
    } else if (nothingToDo) {
      dom.importFootHint.textContent = '当前全部选择跳过，没有需要写入的用例';
    } else {
      dom.importFootHint.textContent =
        `将新增 ${stats.create} 条、覆盖 ${stats.overwrite} 条、跳过 ${stats.skip} 条`;
    }
  }

  function buildImportChip(text, extraClass) {
    const chip = document.createElement('span');
    chip.className = extraClass ? `chip ${extraClass}` : 'chip';
    chip.textContent = text;
    return chip;
  }

  function buildImportItem(row) {
    const item = row.item;
    const wrap = document.createElement('div');
    wrap.className = 'import-item';

    const top = document.createElement('div');
    top.className = 'import-item-top';

    const info = document.createElement('div');
    info.className = 'import-item-info';

    const title = document.createElement('div');
    title.className = 'case-title';
    title.append(
      buildTag(item.method || 'GET', String(item.method || 'GET').toLowerCase()),
      buildImportNameNode(item)
    );

    const urlNode = document.createElement('p');
    urlNode.className = 'import-item-url';
    urlNode.textContent = item.url || '（缺少目标地址）';

    const flags = document.createElement('div');
    flags.className = 'import-item-flags';
    if (!item.valid) flags.appendChild(buildImportFlag('内容不成立，只能跳过', 'invalid'));
    if (item.exists) flags.appendChild(buildImportFlag('名称已存在', 'exists'));
    if (item.duplicateInFile) flags.appendChild(buildImportFlag('文件内还有同名条目', 'dupfile'));
    if (!item.exists && item.valid) flags.appendChild(buildImportFlag('新用例', 'new'));
    flags.appendChild(buildImportFlag(decisionLabel(row), row.mode === 'skip' ? '' : 'new'));

    info.append(title, urlNode, flags);

    const actions = document.createElement('div');
    actions.className = 'import-item-actions';
    if (!item.valid) {
      actions.appendChild(buildChoiceButton('跳过', true, true, () => {}));
    } else if (item.exists) {
      actions.appendChild(
        buildChoiceButton('覆盖已有', row.mode === 'overwrite', false, () => {
          setImportDecision(item.index, { mode: 'overwrite' });
        })
      );
      actions.appendChild(
        buildChoiceButton('另存为新用例', row.mode === 'create', false, () => {
          setImportDecision(item.index, { mode: 'create' });
        })
      );
      actions.appendChild(
        buildChoiceButton('跳过', row.mode === 'skip', false, () => {
          setImportDecision(item.index, { mode: 'skip' });
        })
      );
    } else {
      actions.appendChild(
        buildChoiceButton('新增', row.mode === 'create', false, () => {
          setImportDecision(item.index, { mode: 'create' });
        })
      );
      actions.appendChild(
        buildChoiceButton('跳过', row.mode === 'skip', false, () => {
          setImportDecision(item.index, { mode: 'skip' });
        })
      );
    }

    top.append(info, actions);
    wrap.appendChild(top);

    if (!item.valid) {
      const errors = document.createElement('ul');
      errors.className = 'import-item-errors';
      item.errors.forEach((error) => {
        const line = document.createElement('li');
        line.textContent = error.message;
        errors.appendChild(line);
      });
      wrap.appendChild(errors);
    }

    // 重名库用例选「另存为」时显示改名栏；文件内同名的新用例也允许直接改名字
    if (row.mode === 'create' && (item.exists || item.decision.saveAsName || row.conflict)) {
      wrap.appendChild(buildSaveAsRow(item, row));
    }
    return wrap;
  }

  function buildImportNameNode(item) {
    // 不成立的条目可能连名称都没有，给一个占位文本保证行内仍然可辨认
    const nameNode = document.createElement('span');
    nameNode.className = 'import-item-name';
    nameNode.textContent = item.name || '（缺少用例名称）';
    return nameNode;
  }

  function decisionLabel(row) {
    if (row.mode === 'overwrite') return '将覆盖已有用例';
    if (row.mode === 'create') return row.item.exists ? '将另存为新用例' : '将新增为用例';
    return '将跳过';
  }

  function buildImportFlag(text, kind) {
    const flag = document.createElement('span');
    flag.className = `flag flag-${kind || 'new'}`;
    flag.textContent = text;
    return flag;
  }

  function buildChoiceButton(text, active, disabled, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = active ? 'choice-btn active' : 'choice-btn';
    button.textContent = text;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function buildSaveAsRow(item, row) {
    const wrap = document.createElement('div');
    wrap.className = 'import-saveas';

    const line = document.createElement('div');
    line.className = 'import-saveas-line';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.decision.saveAsName;
    input.maxLength = 60;
    input.autocomplete = 'off';
    input.dataset.index = String(item.index);
    input.setAttribute('aria-label', `用例「${item.name}」另存为的新名称`);
    if (row.conflict) input.classList.add('invalid');
    input.addEventListener('input', () => {
      item.decision.saveAsName = input.value;
      const cursor = input.selectionStart;
      renderImportPreview();
      // 重新渲染后焦点会丢失，按条目编号找回同一个输入框并还原光标位置
      const refocused = dom.importPreview.querySelector(
        `.import-saveas input[data-index="${item.index}"]`
      );
      if (refocused) {
        refocused.focus();
        const pos = Math.min(Number(cursor) || 0, refocused.value.length);
        refocused.setSelectionRange(pos, pos);
      }
    });

    const skipButton = document.createElement('button');
    skipButton.type = 'button';
    skipButton.className = 'btn btn-ghost btn-small';
    skipButton.textContent = '改为跳过';
    skipButton.addEventListener('click', () => setImportDecision(item.index, { mode: 'skip' }));

    line.append(input, skipButton);
    wrap.appendChild(line);
    if (row.conflict) {
      const warn = document.createElement('p');
      warn.className = 'field-error';
      warn.hidden = false;
      warn.textContent = row.conflict;
      wrap.appendChild(warn);
    }
    return wrap;
  }

  async function confirmImport() {
    const session = state.importSession;
    if (!session || session.stage !== 'preview') return;
    const { stats } = evaluateImportPlan();
    if (stats.conflicts || stats.create + stats.overwrite === 0) return;

    const payload = {
      cases: session.items.map((item, index) => {
        const raw = session.rawList[index] && typeof session.rawList[index] === 'object'
          ? session.rawList[index]
          : {};
        const decision = item.decision;
        if (decision.mode === 'skip') {
          return { name: item.name || raw.name || '', action: 'skip' };
        }
        if (decision.mode === 'overwrite') {
          return Object.assign({}, raw, { action: 'overwrite', targetId: decision.targetId });
        }
        const finalName = decision.saveAsName.trim() || item.name;
        return Object.assign({}, raw, { name: finalName, action: 'create' });
      }),
    };

    resetImportSession({ stage: 'committing', fileName: session.fileName });
    renderImportPreview();
    try {
      const result = await request('/api/import/commit', { method: 'POST', body: payload });
      const done = Object.assign({}, state.importSession, { stage: 'done', result });
      state.importSession = done;
      renderImportPreview();
      const c = result.counts || {};
      showNotice(
        `导入完成：新增 ${c.created || 0} 条，覆盖 ${c.overwritten || 0} 条，跳过 ${c.skipped || 0} 条，失败 ${c.failed || 0} 条`,
        c.failed ? 'error' : 'success'
      );
      try {
        await loadCases();
      } catch (err) {
        showNotice(err.message, 'error');
      }
    } catch (err) {
      resetImportSession({
        stage: 'preview-error',
        fileName: session.fileName,
        message: err.message || '导入失败，请稍后重试',
      });
      renderImportPreview();
      showNotice(err.message || '导入失败', 'error');
    }
  }

  function renderImportResult(result) {
    const counts = (result && result.counts) || { created: 0, overwritten: 0, skipped: 0, failed: 0 };
    const summary = document.createElement('div');
    summary.className = 'import-summary';
    summary.appendChild(buildImportChip(`新增 ${counts.created} 条`, ''));
    summary.appendChild(buildImportChip(`覆盖 ${counts.overwritten} 条`, ''));
    summary.appendChild(buildImportChip(`跳过 ${counts.skipped} 条`, ''));
    summary.appendChild(buildImportChip(`失败 ${counts.failed} 条`, counts.failed ? 'chip-bad' : ''));
    dom.importPreview.appendChild(summary);

    const results = (result && result.results) || [];
    if (!results.length) {
      dom.importFootHint.textContent = '本次导入没有写入任何用例';
      return;
    }
    const list = document.createElement('div');
    list.className = 'import-list';
    results.forEach((row) => {
      const line = document.createElement('div');
      line.className = 'import-item';
      const head = document.createElement('div');
      head.className = 'case-title';
      const label = { create: '新增', overwrite: '覆盖', skip: '跳过' }[row.action] || row.action;
      const kind = row.ok ? (row.action === 'skip' ? 'new' : 'exists') : 'invalid';
      head.appendChild(buildImportFlag(row.ok ? `${label}成功` : `${label}失败`, kind));
      const name = document.createElement('span');
      name.className = 'import-item-name';
      name.textContent = row.name || '（未命名条目）';
      head.appendChild(name);
      line.appendChild(head);
      if (!row.ok) {
        const reason = document.createElement('p');
        reason.className = 'import-item-errors';
        reason.textContent = row.message || '导入失败';
        line.appendChild(reason);
      }
      list.appendChild(line);
    });
    dom.importPreview.appendChild(list);
    dom.importFootHint.textContent = '导入结果以服务端实际写入为准；关闭窗口后可在用例区查看。';
  }

  // ---------------- 结果区小零件 ----------------

  function buildSection(title) {
    const section = document.createElement('div');
    section.className = 'result-section';
    const head = document.createElement('p');
    head.className = 'result-section-title';
    head.textContent = title;
    section.appendChild(head);
    return section;
  }

  function buildStatusBadge(code, statusText) {
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    if (!code) {
      badge.classList.add('status-bad');
    } else if (code >= 500) {
      badge.classList.add('status-bad');
    } else if (code >= 400) {
      badge.classList.add('status-warn');
    } else if (code >= 300) {
      badge.classList.add('status-info');
    } else {
      badge.classList.add('status-ok');
    }
    badge.textContent = code ? `${code} ${statusText}`.trim() : statusText;
    return badge;
  }

  function buildChip(text, extraClass) {
    const chip = document.createElement('span');
    chip.className = extraClass ? `chip ${extraClass}` : 'chip';
    chip.textContent = text;
    return chip;
  }

  function buildTab(text, active, onClick) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = active ? 'view-tab active' : 'view-tab';
    tab.textContent = text;
    tab.addEventListener('click', onClick);
    return tab;
  }

  function buildHeaderTable(headers) {
    const list = document.createElement('div');
    list.className = 'header-table';
    headers.forEach((row) => {
      const line = document.createElement('div');
      line.className = 'header-line';
      const keyNode = document.createElement('span');
      keyNode.className = 'header-line-key';
      keyNode.textContent = row.key;
      const valueNode = document.createElement('span');
      valueNode.className = 'header-line-value';
      valueNode.textContent = row.value;
      line.append(keyNode, valueNode);
      list.appendChild(line);
    });
    return list;
  }

  // ---------------- 工具函数 ----------------

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    const pad = (num) => String(num).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }

  function formatDuration(ms) {
    const value = Number(ms) || 0;
    if (value >= 1000) return `${(value / 1000).toFixed(2)} 秒`;
    return `${value} 毫秒`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} 字节`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  async function checkHealth() {
    try {
      await request('/api/health');
      dom.health.textContent = '服务已连接';
      dom.health.classList.add('ok');
    } catch (err) {
      dom.health.textContent = '服务未连接';
      dom.health.classList.add('bad');
    }
  }

  // ---------------- 事件绑定与入口 ----------------

  function bindEvents() {
    dom.headerRows.addEventListener('input', (event) => {
      const target = event.target;
      const index = Number(target.dataset ? target.dataset.index : NaN);
      const part = target.dataset ? target.dataset.part : '';
      if (!Number.isInteger(index) || !state.headers[index] || !part) return;
      state.headers[index][part] = target.value;
      const slot = document.querySelector('[data-error="headers"]');
      if (slot) slot.hidden = true;
      dom.headerRows.classList.remove('invalid');
    });

    dom.headerRows.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action="remove-header"]');
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || !state.headers[index]) return;
      state.headers.splice(index, 1);
      renderHeaderRows();
    });

    dom.addHeader.addEventListener('click', () => {
      state.headers.push({ key: '', value: '' });
      renderHeaderRows();
      const inputs = dom.headerRows.querySelectorAll('input');
      const last = inputs[inputs.length - 2];
      if (last) last.focus();
    });

    dom.sendRequest.addEventListener('click', sendRequest);
    dom.saveCase.addEventListener('click', saveCase);

    dom.resetDraft.addEventListener('click', () => {
      if (state.busy) return;
      resetDraft(false);
    });

    dom.clearResult.addEventListener('click', () => {
      state.result = null;
      renderEmptyResult();
      showNotice('结果区已清空', 'info');
    });

    dom.refreshCases.addEventListener('click', async () => {
      if (state.busy) return;
      try {
        await loadCases();
        showNotice('用例列表已刷新', 'info');
      } catch (err) {
        showNotice(err.message, 'error');
      }
    });

    dom.closeDetail.addEventListener('click', () => {
      state.selectedId = '';
      renderCases();
      renderEmptyDetail();
    });

    dom.caseFilter.addEventListener('input', () => {
      state.filterText = dom.caseFilter.value;
      renderCases();
    });

    dom.caseFilterClear.addEventListener('click', () => {
      dom.caseFilter.value = '';
      state.filterText = '';
      renderCases();
      dom.caseFilter.focus();
    });

    dom.exportButton.addEventListener('click', openExportModal);
    dom.importButton.addEventListener('click', openImportModal);

    dom.exportConfirm.addEventListener('click', confirmExport);
    dom.importConfirm.addEventListener('click', confirmImport);
    dom.importPickFile.addEventListener('click', () => {
      // 先清空已选值，否则再次选择同一个文件不会触发 change
      dom.fileInput.value = '';
      dom.fileInput.click();
    });
    dom.fileInput.addEventListener('change', () => {
      const file = dom.fileInput.files && dom.fileInput.files[0];
      if (file) handleImportFile(file);
    });

    // 单选范围切换时同步导出按钮文案与提示
    dom.exportModal.querySelectorAll('input[name="export-scope"]').forEach((radio) => {
      radio.addEventListener('change', updateExportConfirm);
    });

    // 点遮罩空白处或按 Esc 可以关闭弹窗；导入进行中不允许直接关掉
    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.closeModal);
        if (target) closeModal(target);
      });
    });
    dom.exportModal.addEventListener('click', (event) => {
      if (event.target === dom.exportModal) closeModal(dom.exportModal);
    });
    dom.importModal.addEventListener('click', (event) => {
      const session = state.importSession;
      if (event.target === dom.importModal && (!session || session.stage !== 'committing')) {
        closeModal(dom.importModal);
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!dom.exportModal.hidden) closeModal(dom.exportModal);
      if (!dom.importModal.hidden && state.importSession && state.importSession.stage !== 'committing') {
        closeModal(dom.importModal);
      }
    });
  }

  async function init() {
    bindEvents();
    renderHeaderRows();
    renderEmptyDetail();
    renderEmptyResult();
    renderCases();
    await checkHealth();
    await loadDemos();
    try {
      await loadCases();
    } catch (err) {
      showNotice(err.message, 'error');
    }
  }

  init();
})();
