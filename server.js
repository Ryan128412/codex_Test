import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data", "db.json");

function ensureDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      meta: { nextPackageId: 1, nextDistributionId: 1 },
      packages: [],
      distributions: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validatePackage(input) {
  if (!input.packageName || !String(input.packageName).trim()) {
    return "packageName is required.";
  }
  return null;
}

function validateDistribution(input) {
  if (!input.distributionName || !String(input.distributionName).trim()) {
    return "distributionName is required.";
  }
  return null;
}

function normalizePackage(input) {
  const suppliedParameters = [
    { name: "param_Consol", literalValue: "USD" },
    { name: "Param_Store_Entities", literalValue: "STORE_REG" },
    { name: "Param_Time", literalValue: "|!Param_Time_Input!|" }
  ];

  return {
    packageName: String(input.packageName ?? "").trim(),
    distributionGroup: String(input.distributionGroup ?? ""),
    deliveryType: String(input.deliveryType ?? "Mail (One email)"),
    emailTitle: String(input.emailTitle ?? "Default"),
    emailMessage: String(input.emailMessage ?? "Default"),
    filePath: String(input.filePath ?? ""),
    outputFilename: String(input.outputFilename ?? ""),
    accessGroup: String(input.accessGroup ?? ""),
    packageEnabled: Boolean(input.packageEnabled),
    location: String(input.location ?? ""),
    suppliedParameters
  };
}

function normalizeDistribution(input) {
  return {
    distributionName: String(input.distributionName ?? "").trim(),
    isPublic: String(input.isPublic ?? "enabled"),
    users: Array.isArray(input.users)
      ? input.users.map((u) => ({
          user: String(u.user ?? ""),
          alternateEmail: String(u.alternateEmail ?? ""),
          enabled: Boolean(u.enabled)
        }))
      : []
  };
}

function serveIndex(res) {
  const file = path.join(__dirname, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(file));
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === "GET" && url === "/") {
    serveIndex(res);
    return;
  }

  if (method === "GET" && url === "/api/data") {
    const db = readDb();
    sendJson(res, 200, { packages: db.packages, distributions: db.distributions });
    return;
  }

  if (method === "POST" && url === "/api/packages") {
    try {
      const body = await readRequestBody(req);
      const error = validatePackage(body);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }
      const db = readDb();
      const record = { id: db.meta.nextPackageId++, ...normalizePackage(body) };
      db.packages.push(record);
      writeDb(db);
      sendJson(res, 201, record);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (method === "POST" && url === "/api/distributions") {
    try {
      const body = await readRequestBody(req);
      const error = validateDistribution(body);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }
      const db = readDb();
      const normalized = normalizeDistribution(body);
      if (db.distributions.some((d) => d.distributionName.toLowerCase() === normalized.distributionName.toLowerCase())) {
        sendJson(res, 409, { error: "Distribution name must be unique." });
        return;
      }
      const record = { id: db.meta.nextDistributionId++, ...normalized };
      db.distributions.push(record);
      writeDb(db);
      sendJson(res, 201, record);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (method === "POST" && url === "/api/import") {
    try {
      const body = await readRequestBody(req);
      const db = readDb();
      const incomingPackages = Array.isArray(body.packages) ? body.packages : [];
      const incomingDistributions = Array.isArray(body.distributions) ? body.distributions : [];

      incomingDistributions.forEach((distribution) => {
        const err = validateDistribution(distribution);
        if (err) return;
        const normalized = normalizeDistribution(distribution);
        if (!db.distributions.some((d) => d.distributionName.toLowerCase() === normalized.distributionName.toLowerCase())) {
          db.distributions.push({ id: db.meta.nextDistributionId++, ...normalized });
        }
      });

      incomingPackages.forEach((pkg) => {
        const err = validatePackage(pkg);
        if (err) return;
        db.packages.push({ id: db.meta.nextPackageId++, ...normalizePackage(pkg) });
      });

      writeDb(db);
      sendJson(res, 200, { packages: db.packages, distributions: db.distributions });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (method === "GET" && url === "/api/export") {
    const db = readDb();
    sendJson(res, 200, db);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

ensureDb();
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
});
