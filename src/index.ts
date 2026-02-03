import "dotenv/config";
import express from "express";
import { PromptShield } from "./filters/PromptShield.js";
import { UserManager } from "./UserManager.js";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import { createSupabaseClient } from "./storage/supabase.js";
import { StatsStore } from "./storage/StatsStore.js";
// import fetch from 'node-fetch'; // Removed to use native global fetch

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATS_PATH = path.join(__dirname, "../data/stats.json");

const app = express();
const port = process.env.PORT || 4000;
const shield = new PromptShield();
const supabase = createSupabaseClient();
const users = new UserManager({ supabase });
const statsStore = new StatsStore({ supabase, filePath: STATS_PATH });

if (!supabase) {
  console.warn(
    "Supabase not configured. Falling back to local JSON persistence.",
  );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// --- SCHEMA ---
const ProxyRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ),
  // Pass-through other params loosely
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
});

// --- ROUTES ---

// 1. Dashboard API: Register / Generate Key
app.post("/v1/dashboard/register", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  try {
    const user = await users.createUser(email);
    res.json({ apiKey: user.apiKey, credits: user.credits });
  } catch (e) {
    res.status(500).json({ error: "Failed to create user" });
  }
});

// 2. Dashboard API: Set Provider Key
app.post("/v1/dashboard/configure", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const { provider, key } = req.body; // provider: 'anthropic' | 'openai'

  if (!apiKey) return res.status(401).json({ error: "Missing Shield API Key" });

  const user = await users.getUser(apiKey);
  if (!user)
    return res.status(401).json({ error: "Invalid Shield API Key" });

  const updated = await users.updateProviderKey(apiKey, provider, key);
  if (!updated) {
    return res.status(500).json({ error: "Failed to store provider key" });
  }

  res.json({ status: "ok", message: `Encrypted ${provider} key stored.` });
});

// 3. THE SECURE PROXY (Anthropic Compatible)
app.post("/v1/proxy/anthropic/v1/messages", async (req, res) => {
  handleProxyRequest(req, res, "anthropic");
});

// 4. THE SECURE PROXY (OpenAI Compatible)
app.post("/v1/proxy/openai/v1/chat/completions", async (req, res) => {
  handleProxyRequest(req, res, "openai");
});

// 5. THE SECURE PROXY (Gemini Compatible)
app.post(
  "/v1/proxy/gemini/v1beta/models/gemini-pro:generateContent",
  async (req, res) => {
    handleProxyRequest(req, res, "gemini");
  },
);

async function handleProxyRequest(
  req: express.Request,
  res: express.Response,
  provider: "anthropic" | "openai" | "gemini",
) {
  const shieldKey = req.headers["x-api-key"] as string;
  const user = await users.getUser(shieldKey);

  if (!user)
    return res.status(401).json({ error: "Invalid Prompt Shield API Key" });

  let targetUrl = "";
  let targetKey = "";
  let promptToScan = "";

  if (provider === "anthropic") {
    if (!user.decryptedConfig.anthropicKey)
      return res
        .status(400)
        .json({ error: "No Anthropic Key configured in Dashboard" });
    targetKey = user.decryptedConfig.anthropicKey;
    targetUrl = "https://api.anthropic.com/v1/messages";
    // Extract prompt from Anthropic format
    const body = req.body;
    if (body.messages && body.messages.length > 0) {
      promptToScan = body.messages[body.messages.length - 1].content;
    }
  } else if (provider === "openai") {
    if (!user.decryptedConfig.openaiKey)
      return res
        .status(400)
        .json({ error: "No OpenAI Key configured in Dashboard" });
    targetKey = user.decryptedConfig.openaiKey;
    targetUrl = "https://api.openai.com/v1/chat/completions";
    // Extract prompt from OpenAI format
    const body = req.body;
    if (body.messages && body.messages.length > 0) {
      promptToScan = body.messages[body.messages.length - 1].content;
    }
  } else if (provider === "gemini") {
    if (!user.decryptedConfig.geminiKey)
      return res
        .status(400)
        .json({ error: "No Gemini Key configured in Dashboard" });
    targetKey = user.decryptedConfig.geminiKey;
    // Gemini API normally uses a different URL structure, but we'll assume a proxy/standardized layer
    targetUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
    const body = req.body;
    if (body.contents && body.contents.length > 0) {
      promptToScan = body.contents[body.contents.length - 1].parts[0].text;
    }
  }

  try {
    // A. SHIELD SCAN
    if (promptToScan) {
      // Determine Billing Mode: 'shield-only' (BYOK) vs 'full'
      const billingMode = targetKey ? "shield-only" : "full";

      // If they didn't provide a key and we don't have one (Full Service), we would use OUR key here.
      // For now, Full Service requires implementation of our own key rotation.
      // This logic assumes we ALWAYS prioritize BYOK if available.

      const scanResult = await shield.scan(
        promptToScan,
        "anonymous",
        user.id,
        shieldKey,
        billingMode,
      );

      if ("error" in scanResult) {
        return res.status(401).json({ error: scanResult.error });
      }

      if (!scanResult.safe) {
        await statsStore.incrementAttacks();

        const reason =
          scanResult.matchedPatterns && scanResult.matchedPatterns.length > 0
            ? scanResult.matchedPatterns[0]
            : "Heuristic Block";

        // Block request
        return res.status(406).json({
          type: "error",
          error: {
            type: "prompt_shield_block",
            message: `Prompt Shield Blocked: ${reason}`,
          },
        });
      }
    }

    // B. FORWARD TO PROVIDER
    const headers: any = {
      "content-type": "application/json",
    };

    if (provider === "anthropic") {
      headers["x-api-key"] = targetKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider === "openai") {
      headers["Authorization"] = `Bearer ${targetKey}`;
    }
    // Gemini uses key in URL, headers stays emptyish

    const finalUrl =
      provider === "gemini" ? `${targetUrl}?key=${targetKey}` : targetUrl;

    const providerRes = await fetch(finalUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(req.body),
    });

    const providerData = await providerRes.json();
    res.status(providerRes.status).json(providerData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Proxy Internal Error" });
  }
}

// Legacy Public Scan (for Playground)
app.post("/v1/scan", async (req, res) => {
  const { prompt } = req.body;
  const result = await shield.scan(prompt || "");
  if ("error" in result) return res.status(403).json(result);
  if (!result.safe) {
    await statsStore.incrementAttacks();
  }
  const globalStats = await statsStore.getStats();
  res.json({ ...result, globalStats });
});

app.get("/v1/stats", async (req, res) => {
  const stats = await statsStore.getStats();
  res.json(stats);
});

const startServer = async () => {
  await statsStore.init();
  app.listen(port, () => {
    console.log(`🛡️ Prompt Shield Proxy Active on port ${port}`);
  });
};

startServer();
