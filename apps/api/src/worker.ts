import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { registerScriptProcessingWorker } from "./modules/scripts/script-workbench.routes";
import { registerWorkflowExecutionWorker } from "./modules/workflow/workflow-execute.routes";
import { startMediaAssetCleanupCron } from "./modules/media/media-cleanup";
import { configureOutboundProxy } from "./shared/outbound-proxy";

dotenv.config();
configureOutboundProxy();

let aiClient: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not defined. Please configure it before using AI generation.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
  }
  return aiClient;
}

registerWorkflowExecutionWorker({ getAI });
registerScriptProcessingWorker({ getAI });
startMediaAssetCleanupCron();

console.log("Jiying workflow and script workers started.");
