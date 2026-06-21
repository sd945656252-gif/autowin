import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TextDecoder } from "node:util";

const forbiddenPathPatterns = [
  /^\.env(?:\..*)?$/,
  /^backups\//,
  /^storage\//,
  /^uploads\//,
  /^node_modules\//,
  /^dist\//,
  /^\.logs\//,
  /^config\/api-providers\.local\.json$/,
  /^dump\.rdb$/i,
  /\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|rdb)$/i
];

const allowedEnvExamples = new Set([".env.example", ".env.production.example", ".env.prisma.local.example"]);

const secretPatterns = [
  { name: "OpenAI-style API key", regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "Google API key", regex: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: "private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "hard-coded production secret assignment", regex: /(JWT_SECRET|SESSION_SECRET|GOOGLE_OAUTH_CLIENT_SECRET|GEMINI_API_KEY)\s*=\s*['\"][^'\"]{8,}['\"]/ },
  { name: "browser API config persistence", regex: /localStorage\.setItem\([^\n]*(apiKey|custom_apis|api_config|customApi|provider)/i }
];

const textFilePatterns = [
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|markdown|css|html|yml|yaml|toml|sql|prisma|ps1|cmd|txt|example)$/i,
  /(^|\/)(?:Dockerfile|Dockerfile\.dev|README\.md|\.dockerignore|\.gitignore|\.editorconfig)$/
];

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function stagedFiles() {
  const output = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function trackedFiles() {
  const output = git(["ls-files"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function untrackedFiles() {
  const output = git(["ls-files", "--others", "--exclude-standard"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function isTextFile(file) {
  return textFilePatterns.some((pattern) => pattern.test(file));
}

const scanAllTrackedFiles = process.env.SECURITY_REPO_SCAN_STAGED !== "true";
const selectedFiles = scanAllTrackedFiles
  ? [...trackedFiles(), ...untrackedFiles()]
  : stagedFiles();
const files = Array.from(new Set(selectedFiles.map(normalizePath)));
const errors = [];

for (const file of files) {
  if (allowedEnvExamples.has(file)) continue;
  if (forbiddenPathPatterns.some((pattern) => pattern.test(file))) {
    errors.push(`Forbidden repository path: ${file}`);
  }
}

for (const file of files) {
  if (errors.some((error) => error.endsWith(file))) continue;
  if (/\.(?:png|jpe?g|webp|gif|mp4|mov|zip|pdf|woff2?)$/i.test(file)) continue;

  let bytes;
  let content = "";
  try {
    bytes = readFileSync(file);
  } catch {
    continue;
  }

  if (isTextFile(file)) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      errors.push(`UTF-8 BOM is not allowed in ${file}`);
      continue;
    }
    try {
      content = utf8Decoder.decode(bytes);
    } catch {
      errors.push(`Invalid UTF-8 text file: ${file}`);
      continue;
    }
  } else {
    content = bytes.toString("utf8");
  }

  for (const pattern of secretPatterns) {
    if (pattern.regex.test(content)) {
      errors.push(`Potential secret in ${file}: ${pattern.name}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Repository safety check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Repository safety check passed for ${files.length} ${scanAllTrackedFiles ? "tracked/untracked" : "staged"} file(s).`);
