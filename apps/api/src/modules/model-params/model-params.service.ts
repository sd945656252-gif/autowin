export function normalizeModelName(name: string) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/[-_.\/]+/g, " ")
    .replace(/\b(v?\d+(\.\d+)*)\b/g, "")
    .replace(/\b[0-9a-f]{5,}\b/g, "")
    .split(/\s+/)
    .filter(part => part.length >= 2)
    .join("");
}
