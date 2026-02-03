import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import type { SupabaseClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_DB_PATH = path.join(__dirname, "../data/users.json");
const ENCRYPTION_KEY =
  process.env.SHIELD_ENCRYPTION_SECRET || "fallback-secret-32-chars-long-!!!"; // Should be 32 chars
const IV_LENGTH = 16;

export interface UserProfile {
  id: string; // Internal ID
  apiKey: string; // The "x-prompt-shield-key"
  email: string;
  providerConfig: {
    anthropicKey?: string;
    openaiKey?: string;
    geminiKey?: string;
  };
  credits: number;
  createdAt: number;
}

interface UserRow {
  id: string;
  api_key: string;
  email: string;
  provider_config: UserProfile["providerConfig"] | null;
  credits: number;
  created_at: string | null;
}

export class UserManager {
  private users: Map<string, UserProfile> = new Map();
  private readonly supabase: SupabaseClient | null;

  constructor(options: { supabase?: SupabaseClient | null } = {}) {
    this.supabase = options.supabase ?? null;
    if (!this.supabase) this.load();
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)),
      iv,
    );
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
  }

  private decrypt(text: string): string {
    try {
      const textParts = text.split(":");
      const iv = Buffer.from(textParts.shift()!, "hex");
      const encryptedText = Buffer.from(textParts.join(":"), "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)),
        iv,
      );
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString();
    } catch (e) {
      return text; // Return as is if decryption fails (e.g. if it was already plain text)
    }
  }

  private load() {
    if (!fs.existsSync(USERS_DB_PATH)) {
      this.seedDemoUser();
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(USERS_DB_PATH, "utf8"));
      data.forEach((u: UserProfile) => {
        this.users.set(u.apiKey, u);
      });
    } catch (e) {
      console.error("Failed to load users DB", e);
    }
  }

  private save() {
    const data = Array.from(this.users.values());
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(data, null, 2));
  }

  private seedDemoUser() {
    const user: UserProfile = {
      id: crypto.randomUUID(),
      apiKey: "sk-shield-demo-123",
      email: "demo@promptshield.io",
      providerConfig: {},
      credits: 10.0,
      createdAt: Date.now(),
    };
    this.users.set(user.apiKey, user);
    this.save();
  }

  private mapRow(row: UserRow): UserProfile {
    return {
      id: row.id,
      apiKey: row.api_key,
      email: row.email,
      providerConfig: row.provider_config || {},
      credits: Number(row.credits),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
  }

  public async createUser(
    email: string,
    manualKey?: string,
  ): Promise<UserProfile> {
    const apiKey =
      manualKey || "sk-shield-" + crypto.randomBytes(16).toString("hex");
    const user: UserProfile = {
      id: crypto.randomUUID(),
      apiKey,
      email,
      providerConfig: {},
      credits: 10.0, // $10 free trial
      createdAt: Date.now(),
    };

    if (this.supabase) {
      const { error } = await this.supabase.from("users").insert({
        id: user.id,
        api_key: user.apiKey,
        email: user.email,
        provider_config: user.providerConfig,
        credits: user.credits,
        created_at: new Date(user.createdAt).toISOString(),
      });

      if (error) {
        console.error("Failed to create user", error);
        throw new Error("Failed to create user");
      }

      return user;
    }

    this.users.set(apiKey, user);
    this.save();
    return user;
  }

  public async getUser(
    apiKey: string,
  ): Promise<
    | (UserProfile & { decryptedConfig: UserProfile["providerConfig"] })
    | undefined
  > {
    let user: UserProfile | undefined;

    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("users")
        .select("*")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (error) {
        console.error("Failed to fetch user", error);
        return undefined;
      }

      if (!data) return undefined;
      user = this.mapRow(data as UserRow);
    } else {
      user = this.users.get(apiKey);
    }

    if (!user) return undefined;

    return {
      ...user,
      decryptedConfig: {
        anthropicKey: user.providerConfig.anthropicKey
          ? this.decrypt(user.providerConfig.anthropicKey)
          : undefined,
        openaiKey: user.providerConfig.openaiKey
          ? this.decrypt(user.providerConfig.openaiKey)
          : undefined,
        geminiKey: user.providerConfig.geminiKey
          ? this.decrypt(user.providerConfig.geminiKey)
          : undefined,
      },
    };
  }

  public async updateProviderKey(
    apiKey: string,
    provider: "anthropic" | "openai" | "gemini",
    key: string,
  ): Promise<boolean> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("users")
        .select("provider_config")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (error || !data) {
        if (error) console.error("Failed to read provider config", error);
        return false;
      }

      const existingConfig =
        (data.provider_config as UserProfile["providerConfig"] | null) || {};
      const encryptedKey = this.encrypt(key);
      const updatedConfig = { ...existingConfig };

      if (provider === "anthropic") updatedConfig.anthropicKey = encryptedKey;
      if (provider === "openai") updatedConfig.openaiKey = encryptedKey;
      if (provider === "gemini") updatedConfig.geminiKey = encryptedKey;

      const { error: updateError } = await this.supabase
        .from("users")
        .update({ provider_config: updatedConfig })
        .eq("api_key", apiKey);

      if (updateError) {
        console.error("Failed to update provider config", updateError);
        return false;
      }

      return true;
    }

    const user = this.users.get(apiKey);
    if (!user) return false;

    const encryptedKey = this.encrypt(key);
    if (provider === "anthropic")
      user.providerConfig.anthropicKey = encryptedKey;
    if (provider === "openai") user.providerConfig.openaiKey = encryptedKey;
    if (provider === "gemini") user.providerConfig.geminiKey = encryptedKey;

    this.save();
    return true;
  }

  public async deductCredit(apiKey: string, amount: number): Promise<boolean> {
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from("users")
        .select("credits")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (error || !data) {
        if (error) console.error("Failed to read credits", error);
        return false;
      }

      const nextCredits = Number(data.credits) - amount;
      const { error: updateError } = await this.supabase
        .from("users")
        .update({ credits: nextCredits })
        .eq("api_key", apiKey);

      if (updateError) {
        console.error("Failed to update credits", updateError);
        return false;
      }

      return true;
    }

    const user = this.users.get(apiKey);
    if (!user) return false;
    user.credits -= amount;
    this.save();
    return true;
  }
}
