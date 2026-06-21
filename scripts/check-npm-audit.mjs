import { execFileSync } from "node:child_process";

const npmCommand = process.env.npm_execpath
  ? { file: process.execPath, args: [process.env.npm_execpath] }
  : { file: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
const strict = process.env.SECURITY_AUDIT_STRICT === "true";

const acceptedFindings = [
  {
    name: "uuid",
    advisorySource: 1119441,
    viaDependency: null,
    reason: "Only reached through exceljs@4.4.0. ExcelJS calls uuid.v4() for worksheet metadata; the advisory affects v3/v5/v6 buffer paths. Keep until ExcelJS ships a compatible uuid >=11 update."
  },
  {
    name: "exceljs",
    advisorySource: null,
    viaDependency: "uuid",
    reason: "Wrapper finding for the accepted exceljs -> uuid advisory path."
  }
];

function readAuditReport() {
  try {
    const stdout = execFileSync(npmCommand.file, [...npmCommand.args, "audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = error?.stdout?.toString?.() || "";
    if (!stdout.trim()) {
      throw new Error(error?.stderr?.toString?.().trim() || error?.message || "npm audit failed without JSON output.");
    }
    return JSON.parse(stdout);
  }
}

function viaMatches(via, accepted) {
  if (accepted.advisorySource !== null) {
    return Array.isArray(via) && via.some((item) => typeof item === "object" && item?.source === accepted.advisorySource);
  }
  if (accepted.viaDependency) {
    return Array.isArray(via) && via.length === 1 && via[0] === accepted.viaDependency;
  }
  return false;
}

function isAcceptedFinding(name, finding) {
  return acceptedFindings.some((accepted) => {
    return accepted.name === name && viaMatches(finding.via, accepted);
  });
}

function acceptedReason(name) {
  return acceptedFindings.find((finding) => finding.name === name)?.reason || "Accepted finding.";
}

const report = readAuditReport();
const vulnerabilities = report.vulnerabilities || {};
const accepted = [];
const unexpected = [];

for (const [name, finding] of Object.entries(vulnerabilities)) {
  if (isAcceptedFinding(name, finding)) accepted.push({ name, severity: finding.severity, reason: acceptedReason(name) });
  else unexpected.push({ name, severity: finding.severity, via: finding.via });
}

if (unexpected.length > 0 || (strict && accepted.length > 0)) {
  console.error("npm audit check failed.");
  for (const finding of unexpected) {
    console.error(`- unexpected ${finding.severity}: ${finding.name}`);
  }
  if (strict) {
    for (const finding of accepted) {
      console.error(`- accepted finding blocked by SECURITY_AUDIT_STRICT=true: ${finding.name}`);
    }
  }
  process.exit(1);
}

if (accepted.length > 0) {
  console.warn("npm audit check passed with accepted finding(s):");
  for (const finding of accepted) {
    console.warn(`- ${finding.severity}: ${finding.name} - ${finding.reason}`);
  }
} else {
  console.log("npm audit check passed with no vulnerabilities.");
}
