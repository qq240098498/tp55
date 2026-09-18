const path = require('path');
const express = require('express');
const api = require('./api');
const target = require('./target');
const demos = require('./demo-routes');

const app = express();
const PORT = process.env.PORT || 5055;

// 请求内容按类型分别解析：结构化内容、纯文本与表单内容都能被内置回声接口如实回显
// 导入接口一次可能带上整份用例文件，单独放宽解析上限，并排在通用解析之前生效
app.use('/api/cases/import', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查：页面右上角据此显示服务连接状态
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

// 内置示例接口清单：页面上据此给出填入入口
app.get('/api/demos', (_req, res) => {
  res.json({ endpoints: demos.listEndpoints() });
});

// 发送请求：先按保存用例的同一套规则校验草稿，再真正发出去并回传结果
app.post('/api/send', async (req, res) => {
  let draft = null;
  try {
    draft = api.normalizeRequestDraft(req.body);
  } catch (err) {
    return sendError(res, err);
  }
  const result = await target.sendOutgoing(draft, PORT);
  return res.json(result);
});

app.get('/api/cases', (_req, res) => {
  res.json(api.listCases());
});

app.get('/api/cases/:id', (req, res) => {
  try {
    res.json(api.getCase(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/cases', (req, res) => {
  try {
    res.status(201).json(api.createCase(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 导入预览：只校验与比对，不写库；确认合并才真正落库
app.post('/api/cases/import/preview', (req, res) => {
  try {
    res.json(api.previewImport(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/cases/import', (req, res) => {
  try {
    res.json(api.commitImport(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/cases/:id', (req, res) => {
  try {
    res.json(api.deleteCase(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 内置示例接口，供页面在不填外部地址的情况下试出发送效果
demos.mount(app);

// 未匹配到的接口路径统一返回说明，避免前端拿到一串页面内容
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

// 统一错误出口：业务异常按状态码与错误码返回，其余按服务异常处理
function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp55] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

// 请求体解析失败（内容不是合法 JSON）或超过大小上限时给出明确说明
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '请求内容不是合法的 JSON', field: '' },
    });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'BODY_TOO_LARGE', message: '提交的内容超过大小上限，请拆分后再试', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`接口调试与用例回归对比平台已启动：http://localhost:${PORT}`);
});
