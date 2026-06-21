import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { HttpError } from "../../shared/http";

const MAX_PARSED_TEXT_CHARS = Number(process.env.SCRIPT_PARSED_TEXT_MAX_CHARS || 120_000);

export const SCRIPT_FILE_MIME_BY_EXT: Record<string, string[]> = {
  ".txt": ["text/plain", "text/markdown", "application/octet-stream"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  ".pdf": ["application/pdf", "application/octet-stream"]
};

function normalizeParsedText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").replace(/[\t ]+\n/g, "\n").trim();
  if (!normalized) throw new HttpError(422, "文件未解析出有效文本。PDF 扫描件当前不支持 OCR，请上传可复制文本的 PDF。", "SCRIPT_EMPTY_TEXT");
  if (normalized.length > MAX_PARSED_TEXT_CHARS) {
    throw new HttpError(413, `解析文本过长，请控制在 ${MAX_PARSED_TEXT_CHARS} 字以内。`, "SCRIPT_TEXT_TOO_LONG");
  }
  return normalized;
}

export function assertScriptUploadAccepted(file: Express.Multer.File) {
  if (!file || !file.size) throw new HttpError(400, "上传文件不能为空。", "SCRIPT_EMPTY_FILE");
  const ext = path.extname(file.originalname || "").toLowerCase();
  const allowed = SCRIPT_FILE_MIME_BY_EXT[ext];
  if (!allowed) throw new HttpError(400, "仅支持 txt、docx、pdf 剧本文件。", "SCRIPT_FILE_EXT_NOT_ALLOWED");
  const mime = (file.mimetype || "").split(";")[0].toLowerCase();
  if (mime && !allowed.includes(mime)) {
    throw new HttpError(400, "文件 MIME type 与扩展名不匹配。", "SCRIPT_FILE_MIME_NOT_ALLOWED", { mimeType: mime, extension: ext });
  }
  return ext;
}

export async function parseScriptFile(filePath: string, originalName: string) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  try {
    if (ext === ".txt") {
      const buffer = await fs.readFile(filePath);
      if (buffer.includes(0)) throw new HttpError(400, "txt 文件编码异常，请使用 UTF-8 文本文件。", "SCRIPT_TXT_ENCODING_ERROR");
      return normalizeParsedText(buffer.toString("utf8"));
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      return normalizeParsedText(result.value || "");
    }

    if (ext === ".pdf") {
      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return normalizeParsedText(result.text || "");
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "文件解析失败，请确认文件未损坏且包含可读取文本。", "SCRIPT_PARSE_FAILED");
  }

  throw new HttpError(400, "不支持的剧本文件类型。", "SCRIPT_FILE_UNSUPPORTED");
}
