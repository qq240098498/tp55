const crypto = require('crypto');
const { load, save } = require('./store');

// 允许的请求方式，与页面上的下拉选项保持一致
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const MAX_NAME_LENGTH = 60;
const MAX_URL_LENGTH = 2048;
const MAX_BODY_LENGTH = 200 * 1024;
const MAX_HEADER_COUNT = 30;
// 单次导入的条目上限，避免一份文件把预览与页面渲染拖垮
const MAX_IMPORT_CASES = 200;
// 导出文件的类型标记，导入时据此辨认是不是本平台导出的文件
const EXPORT_KIND = 'tp55-case-export';
// 导入时重名条目可选的处理方式
const IMPORT_ACTIONS = ['create', 'overwrite', 'skip', 'rename'];

// 带错误码与出错位置的业务异常，页面据此把问题标到具体输入项上
class ApiError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field || '';
  }
}

function pickText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateMethod(method) {
  const value = pickText(method).toUpperCase();
  if (!value) throw new ApiError(400, 'METHOD_REQUIRED', '请选择请求方式', 'method');
  if (!ALLOWED_METHODS.includes(value)) {
    throw new ApiError(400, 'METHOD_INVALID', `不支持的请求方式：${value}`, 'method');
  }
  return value;
}

function validateName(name) {
  const value = pickText(name);
  if (!value) throw new ApiError(400, 'NAME_REQUIRED', '请填写用例名称', 'name');
  if (value.length > MAX_NAME_LENGTH) {
    throw new ApiError(400, 'NAME_TOO_LONG', `用例名称不能超过 ${MAX_NAME_LENGTH} 个字符`, 'name');
  }
  return value;
}

// 目标地址支持两种写法：以 / 开头的本机内置示例接口路径，以及完整的 http 或 https 地址
function validateUrl(url) {
  const value = pickText(url);
  if (!value) throw new ApiError(400, 'URL_REQUIRED', '目标地址不能为空', 'url');
  if (value.length > MAX_URL_LENGTH) {
    throw new ApiError(400, 'URL_TOO_LONG', `目标地址不能超过 ${MAX_URL_LENGTH} 个字符`, 'url');
  }
  if (value.startsWith('/')) {
    if (/\s/.test(value)) {
      throw new ApiError(400, 'URL_INVALID', '目标地址里不能出现空格，请检查是否有多余字符', 'url');
    }
    return value;
  }
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch (err) {
    throw new ApiError(400, 'URL_INVALID', '目标地址需要以 http:// 或 https:// 开头，或填写 / 开头的内置示例接口路径', 'url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'URL_PROTOCOL_UNSUPPORTED', '目标地址只支持 http 与 https 两种协议', 'url');
  }
  return value;
}

// 请求头逐行校验：名称必填、字符合法、同名不重复
function validateHeaders(headers) {
  if (headers === undefined || headers === null) return [];
  if (!Array.isArray(headers)) {
    throw new ApiError(400, 'HEADERS_INVALID', '请求头需要按行列表填写', 'headers');
  }
  if (headers.length > MAX_HEADER_COUNT) {
    throw new ApiError(400, 'HEADERS_TOO_MANY', `请求头最多 ${MAX_HEADER_COUNT} 行`, 'headers');
  }
  const list = [];
  const seen = new Set();
  headers.forEach((row, index) => {
    const key = pickText(row && row.key);
    const value = typeof (row && row.value) === 'string' ? row.value : '';
    if (!key && !value) return; // 整行为空的直接跳过
    if (!key) {
      throw new ApiError(400, 'HEADER_KEY_REQUIRED', `第 ${index + 1} 行请求头缺少名称`, `headers.${index}.key`);
    }
    if (/[^!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(key)) {
      throw new ApiError(400, 'HEADER_KEY_INVALID', `请求头名称「${key}」含有非法字符`, `headers.${index}.key`);
    }
    const lower = key.toLowerCase();
    if (seen.has(lower)) {
      throw new ApiError(400, 'HEADER_KEY_DUPLICATE', `请求头「${key}」重复填写`, `headers.${index}.key`);
    }
    seen.add(lower);
    list.push({ key, value });
  });
  return list;
}

// 请求内容按请求方式与内容类型校验：GET 与 HEAD 不允许带内容，JSON 内容必须能解析
function validateBody(body, method, headers) {
  const value = typeof body === 'string' ? body : '';
  if (value.length > MAX_BODY_LENGTH) {
    throw new ApiError(400, 'BODY_TOO_LONG', `请求内容不能超过 ${MAX_BODY_LENGTH} 个字符`, 'body');
  }
  if (!value.trim()) return '';
  if (method === 'GET' || method === 'HEAD') {
    throw new ApiError(400, 'BODY_NOT_ALLOWED', `请求方式为 ${method} 时不支持填写请求内容`, 'body');
  }
  const contentType = headers.find((row) => row.key.toLowerCase() === 'content-type');
  const contentTypeValue = contentType ? contentType.value.toLowerCase() : '';
  if (contentTypeValue.includes('json')) {
    try {
      JSON.parse(value);
    } catch (err) {
      throw new ApiError(400, 'BODY_INVALID_JSON', `请求内容不是合法的 JSON：${err.message}`, 'body');
    }
  }
  return value;
}

// 读取用例列表，按创建时间从新到旧排列，顺序稳定
function listCases() {
  const data = load();
  return data.cases
    .slice()
    .sort((a, b) => {
      if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
}

function getCase(id) {
  const data = load();
  const found = data.cases.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'CASE_NOT_FOUND', '用例不存在或已被删除', '');
  return found;
}

// 请求草稿的公共校验：保存用例与实际发送都走这一套，保证两边判断一致
function normalizeRequestDraft(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const method = validateMethod(input.method);
  const url = validateUrl(input.url);
  const headers = validateHeaders(input.headers);
  const body = validateBody(input.body, method, headers);
  return { method, url, headers, body };
}

function createCase(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const name = validateName(input.name);
  const draft = normalizeRequestDraft(input);

  const data = load();
  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    name,
    method: draft.method,
    url: draft.url,
    headers: draft.headers,
    body: draft.body,
    createdAt: now,
    updatedAt: now,
  };
  data.cases.push(created);
  save(data);
  return created;
}

function deleteCase(id) {
  const data = load();
  const index = data.cases.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'CASE_NOT_FOUND', '用例不存在或已被删除', '');
  const [removed] = data.cases.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

// ---------------- 导入：预览与合并 ----------------

// 导入条目的公共校验：与保存用例走同一套规则，保证两边的判断口径一致
function normalizeImportCase(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(400, 'IMPORT_ITEM_INVALID', '条目结构不正确，需要是包含名称、请求方式与目标地址的对象', '');
  }
  const name = validateName(raw.name);
  const draft = normalizeRequestDraft(raw);
  return { name, method: draft.method, url: draft.url, headers: draft.headers, body: draft.body };
}

// 为「另存为新用例」生成不与现有名称冲突的新名字，并控制在校验允许的长度内
function firstFreeName(base, taken) {
  let index = 2;
  let candidate = '';
  do {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    index += 1;
  } while (taken.has(candidate));
  return candidate;
}

// 同名用例可能不止一条（历史数据没有唯一约束），合并时落在最近更新的那条上
function findExistingByName(cases, name) {
  let found = null;
  cases.forEach((item) => {
    if (item.name !== name) return;
    if (!found || item.updatedAt > found.updatedAt) found = item;
  });
  return found;
}

function readImportList(payload, key) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const list = input[key];
  if (!Array.isArray(list)) {
    throw new ApiError(400, 'IMPORT_CASES_REQUIRED', '导入内容里需要包含用例列表', '');
  }
  if (!list.length) {
    throw new ApiError(400, 'IMPORT_EMPTY', '导入内容里没有任何用例条目', '');
  }
  if (list.length > MAX_IMPORT_CASES) {
    throw new ApiError(400, 'IMPORT_TOO_MANY', `一次最多导入 ${MAX_IMPORT_CASES} 条用例，请拆分后再试`, '');
  }
  return list;
}

// 预览：逐条校验并标出与现有用例、与文件内前面条目重名的情况，不产生任何写入
function previewImport(payload) {
  const list = readImportList(payload, 'cases');
  const data = load();
  const existingNames = new Set(data.cases.map((item) => item.name));
  // taken 随条目顺序推进：先是库里的名字，再逐个并入文件里前面的条目与建议的新名字
  const taken = new Set(existingNames);

  const items = list.map((raw, index) => {
    let normalized = null;
    try {
      normalized = normalizeImportCase(raw);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return {
        index,
        status: 'invalid',
        name: raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '',
        error: err.message,
        field: err.field,
      };
    }

    const item = {
      index,
      status: taken.has(normalized.name) ? 'duplicate' : 'new',
      name: normalized.name,
      summary: {
        method: normalized.method,
        url: normalized.url,
        headerCount: normalized.headers.length,
        bodyLength: normalized.body.length,
      },
    };
    if (item.status === 'duplicate') {
      item.duplicateOf = existingNames.has(normalized.name) ? 'existing' : 'file';
      item.renameTo = firstFreeName(normalized.name, taken);
      taken.add(item.renameTo);
    } else {
      taken.add(normalized.name);
    }
    return item;
  });

  return {
    total: items.length,
    valid: items.filter((item) => item.status !== 'invalid').length,
    invalid: items.filter((item) => item.status === 'invalid').length,
    duplicates: items.filter((item) => item.status === 'duplicate').length,
    items,
  };
}

// 合并：按名称落库。每条的动作由页面在预览里选定，这里重新校验后再执行
function commitImport(payload) {
  const list = readImportList(payload, 'items');
  const data = load();
  const taken = new Set(data.cases.map((item) => item.name));
  const now = new Date().toISOString();

  const counts = { created: 0, overwritten: 0, renamed: 0, skipped: 0, invalid: 0 };
  const results = list.map((entry, index) => {
    const input = entry && typeof entry === 'object' ? entry : {};
    const action = typeof input.action === 'string' ? input.action : '';
    if (!IMPORT_ACTIONS.includes(action)) {
      throw new ApiError(400, 'IMPORT_ACTION_INVALID', `第 ${index + 1} 条的处理方式不正确`, '');
    }
    if (action === 'skip') {
      counts.skipped += 1;
      return { index, outcome: 'skipped', name: pickText(input.case && input.case.name) };
    }

    let normalized = null;
    try {
      normalized = normalizeImportCase(input.case);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      counts.invalid += 1;
      return { index, outcome: 'invalid', name: '', error: err.message };
    }

    if (action === 'create') {
      if (taken.has(normalized.name)) {
        // 预览之后库里才出现的同名，稳妥起见不覆盖，按跳过处理
        counts.skipped += 1;
        return { index, outcome: 'skipped', name: normalized.name, error: '已存在同名用例，未新建' };
      }
      taken.add(normalized.name);
      data.cases.push({ id: crypto.randomUUID(), ...normalized, createdAt: now, updatedAt: now });
      counts.created += 1;
      return { index, outcome: 'created', name: normalized.name };
    }

    // 重名条目：与预览保持同一套占位规则，另存时的新名字两边一致
    const freeName = firstFreeName(normalized.name, taken);
    taken.add(freeName);

    if (action === 'rename') {
      data.cases.push({ id: crypto.randomUUID(), ...normalized, name: freeName, createdAt: now, updatedAt: now });
      counts.renamed += 1;
      return { index, outcome: 'renamed', name: normalized.name, finalName: freeName };
    }

    // overwrite：目标已被删掉时退化为新建
    const target = findExistingByName(data.cases, normalized.name);
    if (!target) {
      data.cases.push({ id: crypto.randomUUID(), ...normalized, createdAt: now, updatedAt: now });
      counts.created += 1;
      return { index, outcome: 'created', name: normalized.name };
    }
    target.method = normalized.method;
    target.url = normalized.url;
    target.headers = normalized.headers;
    target.body = normalized.body;
    target.updatedAt = now;
    counts.overwritten += 1;
    return { index, outcome: 'overwritten', name: normalized.name };
  });

  save(data);
  return { total: list.length, ...counts, results };
}

module.exports = {
  ApiError,
  ALLOWED_METHODS,
  EXPORT_KIND,
  MAX_IMPORT_CASES,
  normalizeRequestDraft,
  listCases,
  getCase,
  createCase,
  deleteCase,
  previewImport,
  commitImport,
};
