export type ParsedMediaRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "range";
      start: number;
      end: number;
      contentLength: number;
      contentRange: string;
    };

export function parseMediaRange(rangeHeader: string | undefined, fileSize: number): ParsedMediaRange {
  if (!rangeHeader) return { kind: "none" };
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return { kind: "invalid" };

  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return { kind: "invalid" };

  const start = Number.parseInt(match[1], 10);
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
  const end = Number.isNaN(requestedEnd) ? fileSize - 1 : Math.min(requestedEnd, fileSize - 1);

  if (Number.isNaN(start) || start >= fileSize || end < start) {
    return { kind: "invalid" };
  }

  return {
    kind: "range",
    start,
    end,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${fileSize}`
  };
}
