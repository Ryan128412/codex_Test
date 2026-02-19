import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, 'data', 'app.db');

const SUPPLIED_PARAMETERS = [
  { name: 'param_Consol', literalValue: 'USD' },
  { name: 'Param_Store_Entities', literalValue: 'STORE_REG' },
  { name: 'Param_Time', literalValue: '|!Param_Time_Input!|' }
];

function sqlEscape(value) { return String(value ?? '').replace(/'/g, "''"); }
function sqlite(sql, json = false) {
  const args = json ? ['-json', DB_PATH, sql] : [DB_PATH, sql];
  const output = execFileSync('sqlite3', args, { encoding: 'utf8' });
  return json ? JSON.parse(output || '[]') : output;
}

function ensureDb() {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  execFileSync('node', [path.join(__dirname, 'scripts', 'migrate.js')]);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function validatePackage(p) {
  if (!String(p.packageName || '').trim()) return 'packageName is required.';
  const delivery = p.deliveryType || 'Mail (One email)';
  if (!['Mail (One email)', 'Mail Individual Emails'].includes(delivery)) return 'deliveryType is invalid.';
  return null;
}
function validateDistribution(d) {
  if (!String(d.distributionName || '').trim()) return 'distributionName is required.';
  if (!['enabled', 'disabled', undefined].includes(d.isPublic)) return 'isPublic is invalid.';
  return null;
}

function getData() {
  const packages = sqlite('SELECT * FROM packages ORDER BY id;', true).map((p) => ({
    id: p.id,
    packageName: p.package_name,
    distributionGroup: p.distribution_group || '',
    deliveryType: p.delivery_type,
    emailTitle: p.email_title,
    emailMessage: p.email_message,
    filePath: p.file_path || '',
    outputFilename: p.output_filename || '',
    accessGroup: p.access_group || '',
    packageEnabled: Boolean(p.package_enabled),
    location: p.location || '',
    suppliedParameters: SUPPLIED_PARAMETERS
  }));

  const distributions = sqlite('SELECT * FROM distributions ORDER BY id;', true).map((d) => {
    const users = sqlite(`SELECT user_name, alternate_email, enabled FROM distribution_users WHERE distribution_id = ${d.id} ORDER BY id;`, true)
      .map((u) => ({ user: u.user_name, alternateEmail: u.alternate_email || '', enabled: Boolean(u.enabled) }));
    return { id: d.id, distributionName: d.distribution_name, isPublic: d.is_public, users };
  });
  return { packages, distributions };
}

function saveDistribution(input) {
  const name = String(input.distributionName).trim();
  const isPublic = input.isPublic === 'disabled' ? 'disabled' : 'enabled';
  const users = Array.isArray(input.users) ? input.users : [];
  const id = Number(input.id || 0);

  if (id) {
    sqlite(`UPDATE distributions SET distribution_name='${sqlEscape(name)}', is_public='${isPublic}', updated_at=CURRENT_TIMESTAMP WHERE id=${id};`);
    sqlite(`DELETE FROM distribution_users WHERE distribution_id=${id};`);
    users.forEach((u) => sqlite(`INSERT INTO distribution_users(distribution_id, user_name, alternate_email, enabled) VALUES (${id}, '${sqlEscape(u.user)}', '${sqlEscape(u.alternateEmail)}', ${u.enabled ? 1 : 0});`));
    return;
  }

  sqlite(`INSERT INTO distributions(distribution_name, is_public) VALUES ('${sqlEscape(name)}', '${isPublic}');`);
  const created = sqlite('SELECT last_insert_rowid() AS id;', true)[0];
  users.forEach((u) => sqlite(`INSERT INTO distribution_users(distribution_id, user_name, alternate_email, enabled) VALUES (${created.id}, '${sqlEscape(u.user)}', '${sqlEscape(u.alternateEmail)}', ${u.enabled ? 1 : 0});`));
}

function savePackage(input) {
  const id = Number(input.id || 0);
  const fields = {
    package_name: sqlEscape(input.packageName),
    distribution_group: sqlEscape(input.distributionGroup),
    delivery_type: sqlEscape(input.deliveryType || 'Mail (One email)'),
    email_title: sqlEscape(input.emailTitle || 'Default'),
    email_message: sqlEscape(input.emailMessage || 'Default'),
    file_path: sqlEscape(input.filePath),
    output_filename: sqlEscape(input.outputFilename),
    access_group: sqlEscape(input.accessGroup),
    package_enabled: input.packageEnabled ? 1 : 0,
    location: sqlEscape(input.location)
  };

  if (fields.distribution_group) {
    const exists = sqlite(`SELECT id FROM distributions WHERE lower(distribution_name)=lower('${fields.distribution_group}') LIMIT 1;`, true);
    if (!exists.length) throw new Error(`distributionGroup '${input.distributionGroup}' does not exist.`);
  }

  if (id) {
    sqlite(`UPDATE packages SET package_name='${fields.package_name}', distribution_group='${fields.distribution_group}', delivery_type='${fields.delivery_type}', email_title='${fields.email_title}', email_message='${fields.email_message}', file_path='${fields.file_path}', output_filename='${fields.output_filename}', access_group='${fields.access_group}', package_enabled=${fields.package_enabled}, location='${fields.location}', updated_at=CURRENT_TIMESTAMP WHERE id=${id};`);
    return;
  }

  sqlite(`INSERT INTO packages(package_name, distribution_group, delivery_type, email_title, email_message, file_path, output_filename, access_group, package_enabled, location) VALUES ('${fields.package_name}', '${fields.distribution_group}', '${fields.delivery_type}', '${fields.email_title}', '${fields.email_message}', '${fields.file_path}', '${fields.output_filename}', '${fields.access_group}', ${fields.package_enabled}, '${fields.location}');`);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

ensureDb();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/data') {
    sendJson(res, 200, getData());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/distributions') {
    try {
      const body = await parseBody(req);
      const error = validateDistribution(body);
      if (error) return sendJson(res, 400, { error });
      saveDistribution(body);
      sendJson(res, 201, getData());
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/distributions/')) {
    try {
      const body = await parseBody(req);
      body.id = Number(url.pathname.split('/').pop());
      const error = validateDistribution(body);
      if (error) return sendJson(res, 400, { error });
      saveDistribution(body);
      sendJson(res, 200, getData());
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/packages') {
    try {
      const body = await parseBody(req);
      const error = validatePackage(body);
      if (error) return sendJson(res, 400, { error });
      savePackage(body);
      sendJson(res, 201, getData());
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/packages/')) {
    try {
      const body = await parseBody(req);
      body.id = Number(url.pathname.split('/').pop());
      const error = validatePackage(body);
      if (error) return sendJson(res, 400, { error });
      savePackage(body);
      sendJson(res, 200, getData());
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    try {
      const body = await parseBody(req);
      const incomingDistributions = Array.isArray(body.distributions) ? body.distributions : [];
      const incomingPackages = Array.isArray(body.packages) ? body.packages : [];
      incomingDistributions.forEach((d) => { const e = validateDistribution(d); if (e) throw new Error(e); saveDistribution(d); });
      incomingPackages.forEach((p) => { const e = validatePackage(p); if (e) throw new Error(e); savePackage(p); });
      sendJson(res, 200, getData());
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/export') {
    const data = getData();
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    if (format === 'csv') {
      const rows = [
        ...data.packages.map((p) => ({ entityType: 'Package', ...p, suppliedParameters: JSON.stringify(p.suppliedParameters) })),
        ...data.distributions.map((d) => ({ entityType: 'Distribution', ...d, users: JSON.stringify(d.users) }))
      ];
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="parcel-service-export.csv"' });
      res.end(toCsv(rows));
      return;
    }
    sendJson(res, 200, data);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
