(function () {
  'use strict';

  // 页面状态：用例列表、内置示例接口、请求头草稿行、最近一次响应结果与结果视图
  // filter 是用例区的筛选词；importData 保存一次导入会话的解析结果与逐条选择
  const state = {
    cases: [],
    selectedId: '',
    headers: [{ key: '', value: '' }],
    demos: [],
    busy: false,
    result: null,
    resultView: 'structured',
    filter: '',
    exporting: false,
    importing: false,
    importData: null,
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
    caseFilter: document.getElementById('case-filter'),
    exportCases: document.getElementById('export-cases'),
    importCases: document.getElementById('import-cases'),
    caseDetail: document.getElementById('case-detail'),
    closeDetail: document.getElementById('close-detail'),
    exportModal: document.getElementById('export-modal'),
    exportAllCount: document.getElementById('export-all-count'),
    exportVisibleCount: document.getElementById('export-visible-count'),
    exportHint: document.getElementById('export-hint'),
    exportError: document.getElementById('export-error'),
    exportConfirm: document.getElementById('export-confirm'),
    exportCancel: document.getElementById('export-cancel'),
    exportClose: document.getElementById('export-close'),
    importModal: document.getElementById('import-modal'),
    importFile: document.getElementById('import-file'),
    importFileError: document.getElementById('import-file-error'),
    importStepFile: document.getElementById('import-step-file'),
    importStepPreview: document.getElementById('import-step-preview'),
    importSummary: document.getElementById('import-summary'),
    importRows: document.getElementById('import-rows'),
    importPlan: document.getElementById('import-plan'),
    importConfirm: document.getElementById('import-confirm'),
    importRepick: document.getElementById('import-repick'),
    importCancel: document.getElementById('import-cancel'),
    importClose: document.getElementById('import-close'),
  };

  const emptyDetailHint = '在用例列表点「详情」，这里显示该用例保存下来的目标地址、请求头与请求内容。';
  // 结构化视图最多铺开的层级条目数量，避免内容过大时页面卡顿
  const TREE_LIMIT = 800;
  // 与服务端保持一致：单次导入的条目数与文件大小上限
  const IMPORT_MAX_CASES = 200;
  const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
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
    dom.exportCases.disabled = busy;
    dom.importCases.disabled = busy;
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

  // 筛选匹配：名称、地址、请求方式任一包含关键词即算命中
  function caseMatches(item, query) {
    return item.name.toLowerCase().includes(query)
      || item.url.toLowerCase().includes(query)
      || String(item.method).toLowerCase().includes(query);
  }

  // 当前可见的用例：设置了筛选词时按名称、地址、请求方式匹配，否则就是全部
  function visibleCases() {
    const query = state.filter.trim().toLowerCase();
    if (!query) return state.cases;
    return state.cases.filter((item) => caseMatches(item, query));
  }

  function renderCases() {
    const visible = visibleCases();
    dom.caseSummary.textContent = state.filter.trim()
      ? `显示 ${visible.length} / 共 ${state.cases.length} 条`
      : `共 ${state.cases.length} 条`;
    dom.caseList.textContent = '';

    if (!state.cases.length) {
      dom.caseList.appendChild(
        buildEmptyBlock('还没有保存过用例', '在请求区填好内容后点「保存为用例」，用例会出现在这里。')
      );
      return;
    }
    if (!visible.length) {
      dom.caseList.appendChild(
        buildEmptyBlock('没有符合筛选条件的用例', '换个关键词试试，或清空筛选框查看全部。')
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

  // ---------------- 导出 ----------------

  function exportScope() {
    const checked = document.querySelector('input[name="export-scope"]:checked');
    return checked && checked.value === 'visible' ? 'visible' : 'all';
  }

  function openExportModal() {
    const visible = visibleCases().length;
    dom.exportAllCount.textContent = `（共 ${state.cases.length} 条）`;
    dom.exportVisibleCount.textContent = state.filter.trim()
      ? `（当前筛选下 ${visible} 条）`
      : `（未设置筛选，即全部 ${visible} 条）`;
    document.querySelector('input[name="export-scope"][value="all"]').checked = true;
    updateExportConfirm();
    dom.exportModal.hidden = false;
  }

  function closeExportModal() {
    if (state.exporting) return;
    dom.exportModal.hidden = true;
  }

  // 所选范围内一条都没有时不允许导出，直接在弹窗里说明，而不是生成一份空文件
  function updateExportConfirm() {
    const scope = exportScope();
    const count = scope === 'visible' ? visibleCases().length : state.cases.length;
    dom.exportConfirm.disabled = count === 0;
    if (count === 0) {
      dom.exportError.textContent = scope === 'visible' && state.filter.trim()
        ? '当前筛选条件下没有可见用例，无法导出'
        : '用例库还是空的，没有可导出的用例';
      dom.exportError.hidden = false;
    } else {
      dom.exportError.hidden = true;
    }
  }

  function exportFileName() {
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `用例导出-${stamp}.json`;
  }

  // 导出内容只保留用例本身的字段，文件可读、可手工编辑，也能再导入回来
  function buildExportPayload(cases, scope) {
    return {
      kind: 'tp55-case-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope,
      count: cases.length,
      cases: cases.map((item) => ({
        name: item.name,
        method: item.method,
        url: item.url,
        headers: item.headers.map((row) => ({ key: row.key, value: row.value })),
        body: item.body,
      })),
    };
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function runExport() {
    if (state.exporting) return;
    const scope = exportScope();
    state.exporting = true;
    dom.exportConfirm.disabled = true;
    dom.exportCancel.disabled = true;
    dom.exportConfirm.textContent = '正在导出…';
    try {
      // 导出前重新拉一次，保证文件内容是用例库的最新状态
      const list = await request('/api/cases');
      const all = Array.isArray(list) ? list : [];
      const query = state.filter.trim().toLowerCase();
      const picked = scope === 'visible' && query
        ? all.filter((item) => caseMatches(item, query))
        : all;
      if (!picked.length) {
        dom.exportModal.hidden = true;
        showNotice(
          scope === 'visible' && query
            ? '当前筛选条件下没有可见用例，未生成导出文件'
            : '用例库还是空的，没有可导出的用例，未生成导出文件',
          'error'
        );
        return;
      }
      const payload = buildExportPayload(picked, scope);
      downloadTextFile(exportFileName(), `${JSON.stringify(payload, null, 2)}\n`);
      state.cases = all;
      if (state.selectedId && !all.some((item) => item.id === state.selectedId)) {
        state.selectedId = '';
      }
      renderCases();
      dom.exportModal.hidden = true;
      showNotice(
        `已导出 ${picked.length} 条用例（${scope === 'visible' ? '当前可见' : '全部用例'}），文件已交给浏览器下载`,
        'success'
      );
    } catch (err) {
      dom.exportError.textContent = err.message;
      dom.exportError.hidden = false;
    } finally {
      state.exporting = false;
      dom.exportCancel.disabled = false;
      dom.exportConfirm.textContent = '开始导出';
      updateExportConfirm();
    }
  }

  // ---------------- 导入 ----------------

  function resetImportModal() {
    state.importData = null;
    dom.importFile.value = '';
    dom.importFileError.hidden = true;
    dom.importFileError.textContent = '';
    dom.importStepFile.hidden = false;
    dom.importStepPreview.hidden = true;
    dom.importConfirm.hidden = true;
    dom.importConfirm.disabled = false;
    dom.importConfirm.textContent = '开始导入';
    dom.importRepick.hidden = true;
    dom.importRepick.disabled = false;
    dom.importCancel.disabled = false;
  }

  function openImportModal() {
    resetImportModal();
    dom.importModal.hidden = false;
  }

  function closeImportModal() {
    if (state.importing) return;
    dom.importModal.hidden = true;
  }

  function showImportFileError(message) {
    dom.importFileError.textContent = message;
    dom.importFileError.hidden = false;
  }

  // 从文件文本里取出用例数组：支持本平台的导出文件，也支持裸的用例数组
  function extractImportCases(text) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('文件不是合法的 JSON，无法导入');
    }
    let cases = null;
    if (Array.isArray(parsed)) {
      cases = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (typeof parsed.kind === 'string' && parsed.kind !== 'tp55-case-export') {
        throw new Error('这份文件不是本平台导出的用例文件，请换一份试试');
      }
      if (Array.isArray(parsed.cases)) cases = parsed.cases;
    }
    if (!cases) throw new Error('文件结构不正确：需要是用例数组，或包含 cases 数组的导出文件');
    if (!cases.length) throw new Error('文件里没有任何用例条目');
    if (cases.length > IMPORT_MAX_CASES) {
      throw new Error(`一次最多导入 ${IMPORT_MAX_CASES} 条用例，这份文件有 ${cases.length} 条，请拆分后再试`);
    }
    return cases;
  }

  async function handleImportFile(file) {
    dom.importFileError.hidden = true;
    if (!file) return;
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      showImportFileError(`文件过大（${formatBytes(file.size)}），超过 ${formatBytes(IMPORT_MAX_FILE_BYTES)} 的上限，请拆分后再导入`);
      return;
    }
    let cases = null;
    try {
      const text = await file.text();
      cases = extractImportCases(text);
    } catch (err) {
      showImportFileError(err.message);
      return;
    }
    try {
      // 逐条校验交给服务端，与保存用例走同一套规则
      const preview = await request('/api/cases/import/preview', { method: 'POST', body: { cases } });
      state.importData = {
        cases,
        items: preview.items.map((item) => ({
          ...item,
          action: item.status === 'duplicate' ? 'skip' : 'create',
        })),
      };
      renderImportPreview(preview);
    } catch (err) {
      showImportFileError(err.message);
    }
  }

  function renderImportPreview(preview) {
    dom.importStepFile.hidden = true;
    dom.importStepPreview.hidden = false;
    dom.importConfirm.hidden = false;
    dom.importRepick.hidden = false;
    const fresh = preview.total - preview.duplicates - preview.invalid;
    dom.importSummary.textContent = `文件共 ${preview.total} 条：可直接新建 ${fresh} 条，名称已存在 ${preview.duplicates} 条，内容不成立 ${preview.invalid} 条。`;
    dom.importRows.textContent = '';
    state.importData.items.forEach((item) => {
      dom.importRows.appendChild(buildImportRow(item));
    });
    updateImportPlan();
  }

  function buildImportRow(item) {
    const row = document.createElement('div');
    row.className = 'import-row';

    const main = document.createElement('div');
    main.className = 'import-main';

    const title = document.createElement('div');
    title.className = 'import-title';
    const tag = document.createElement('span');
    tag.className = 'import-tag';
    const nameNode = document.createElement('span');
    nameNode.className = 'import-name';
    nameNode.textContent = item.name || '（未填写名称的条目）';
    title.append(tag, nameNode);
    main.appendChild(title);

    if (item.status === 'invalid') {
      const errorNode = document.createElement('p');
      errorNode.className = 'import-note bad';
      errorNode.textContent = `内容不成立：${item.error}`;
      main.appendChild(errorNode);
    } else {
      const urlNode = document.createElement('p');
      urlNode.className = 'import-url';
      urlNode.textContent = `${item.summary.method} ${item.summary.url}`;
      main.appendChild(urlNode);
      const metaNode = document.createElement('p');
      metaNode.className = 'import-note';
      metaNode.textContent = `请求头 ${item.summary.headerCount} 行 · 请求内容 ${item.summary.bodyLength} 字符`;
      main.appendChild(metaNode);
      if (item.status === 'duplicate') {
        const dupNode = document.createElement('p');
        dupNode.className = 'import-note';
        dupNode.textContent = item.duplicateOf === 'existing' ? '与现有用例重名' : '与文件内前面的条目重名';
        main.appendChild(dupNode);
      }
    }
    row.appendChild(main);

    // 重名条目逐条给出处理方式，选择结果立刻反映在行的标记上
    if (item.status === 'duplicate') {
      const actionWrap = document.createElement('div');
      actionWrap.className = 'import-action';
      const select = document.createElement('select');
      select.setAttribute('aria-label', `条目「${item.name}」名称已存在，选择处理方式`);
      [['skip', '跳过该条'], ['overwrite', '覆盖现有用例'], ['rename', '另存为新用例']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
      select.value = item.action;
      select.addEventListener('change', () => {
        item.action = select.value;
        updateImportRow(row, tag, item);
        updateImportPlan();
      });
      actionWrap.appendChild(select);
      row.appendChild(actionWrap);
    }

    updateImportRow(row, tag, item);
    return row;
  }

  // 行的标记与底色跟随该条的状态或已选处理方式，选择结果一眼可见
  function updateImportRow(row, tag, item) {
    row.classList.remove('action-create', 'action-overwrite', 'action-rename', 'action-skip', 'action-invalid');
    tag.className = 'import-tag';
    if (item.status === 'invalid') {
      row.classList.add('action-invalid');
      tag.classList.add('bad');
      tag.textContent = '不成立';
      return;
    }
    if (item.status === 'new') {
      row.classList.add('action-create');
      tag.classList.add('new');
      tag.textContent = '将新建';
      return;
    }
    if (item.action === 'overwrite') {
      row.classList.add('action-overwrite');
      tag.classList.add('dup');
      tag.textContent = '将覆盖现有';
    } else if (item.action === 'rename') {
      row.classList.add('action-rename');
      tag.classList.add('rename');
      tag.textContent = `将另存为「${item.renameTo}」`;
    } else {
      row.classList.add('action-skip');
      tag.classList.add('skip');
      tag.textContent = '将跳过';
    }
  }

  // 预览底部的计划汇总：跟着逐条选择实时变化
  function updateImportPlan() {
    const items = state.importData ? state.importData.items : [];
    const count = { create: 0, overwrite: 0, rename: 0, skip: 0, invalid: 0 };
    items.forEach((item) => {
      if (item.status === 'invalid') count.invalid += 1;
      else if (item.status === 'new') count.create += 1;
      else count[item.action] += 1;
    });
    const parts = [];
    if (count.create) parts.push(`新建 ${count.create} 条`);
    if (count.overwrite) parts.push(`覆盖 ${count.overwrite} 条`);
    if (count.rename) parts.push(`另存 ${count.rename} 条`);
    if (count.skip) parts.push(`跳过 ${count.skip} 条`);
    if (count.invalid) parts.push(`${count.invalid} 条不成立不会导入`);
    const effective = count.create + count.overwrite + count.rename;
    dom.importPlan.textContent = effective
      ? `按计划本次将：${parts.join('，')}。`
      : '当前没有会导入的条目：全部跳过或内容不成立。';
    dom.importConfirm.disabled = !effective || state.importing;
  }

  function importSummaryText(result) {
    const parts = [];
    if (result.created) parts.push(`新建 ${result.created} 条`);
    if (result.overwritten) parts.push(`覆盖 ${result.overwritten} 条`);
    if (result.renamed) parts.push(`另存 ${result.renamed} 条`);
    if (result.skipped) parts.push(`跳过 ${result.skipped} 条`);
    if (result.invalid) parts.push(`${result.invalid} 条未通过校验未导入`);
    if (!result.created && !result.overwritten && !result.renamed) {
      return `导入完成，但没有写入任何用例${parts.length ? `（${parts.join('，')}）` : ''}`;
    }
    return `导入完成：${parts.join('，')}`;
  }

  async function runImport() {
    if (state.importing || !state.importData) return;
    const items = state.importData.items
      .filter((item) => item.status !== 'invalid')
      .map((item) => ({
        case: state.importData.cases[item.index],
        action: item.status === 'new' ? 'create' : item.action,
      }));
    if (!items.length) return;

    state.importing = true;
    dom.importConfirm.disabled = true;
    dom.importRepick.disabled = true;
    dom.importCancel.disabled = true;
    dom.importConfirm.textContent = '正在导入…';
    try {
      const result = await request('/api/cases/import', { method: 'POST', body: { items } });
      dom.importModal.hidden = true;
      state.importData = null;
      await loadCases();
      showNotice(importSummaryText(result), 'success');
    } catch (err) {
      showNotice(err.message, 'error');
    } finally {
      state.importing = false;
      dom.importConfirm.disabled = false;
      dom.importRepick.disabled = false;
      dom.importCancel.disabled = false;
      dom.importConfirm.textContent = '开始导入';
    }
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
      state.filter = dom.caseFilter.value;
      renderCases();
    });

    dom.exportCases.addEventListener('click', () => {
      if (state.busy) return;
      openExportModal();
    });

    dom.importCases.addEventListener('click', () => {
      if (state.busy) return;
      openImportModal();
    });

    document.querySelectorAll('input[name="export-scope"]').forEach((radio) => {
      radio.addEventListener('change', updateExportConfirm);
    });
    dom.exportConfirm.addEventListener('click', runExport);
    dom.exportCancel.addEventListener('click', closeExportModal);
    dom.exportClose.addEventListener('click', closeExportModal);

    dom.importFile.addEventListener('change', () => {
      const file = dom.importFile.files && dom.importFile.files[0];
      handleImportFile(file);
    });
    dom.importConfirm.addEventListener('click', runImport);
    dom.importRepick.addEventListener('click', resetImportModal);
    dom.importCancel.addEventListener('click', closeImportModal);
    dom.importClose.addEventListener('click', closeImportModal);

    // 点遮罩或按 ESC 关闭弹窗；导出、导入进行中不允许关闭
    [dom.exportModal, dom.importModal].forEach((modal) => {
      modal.addEventListener('click', (event) => {
        if (event.target !== modal) return;
        if (modal === dom.exportModal) closeExportModal();
        else closeImportModal();
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!dom.exportModal.hidden) closeExportModal();
      if (!dom.importModal.hidden) closeImportModal();
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
