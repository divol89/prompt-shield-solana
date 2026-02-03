import fs from "fs";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GlobalStats {
  totalAttacks: number;
}

interface StatsRow {
  id: string;
  total_attacks: number;
}

export class StatsStore {
  private readonly supabase: SupabaseClient | null;
  private readonly filePath: string;
  private readonly seedValue: number;
  private stats: GlobalStats;

  constructor(options: {
    supabase?: SupabaseClient | null;
    filePath: string;
    seedValue?: number;
  }) {
    this.supabase = options.supabase ?? null;
    this.filePath = options.filePath;
    this.seedValue = options.seedValue ?? 12842;
    this.stats = { totalAttacks: this.seedValue };
  }

  async init(): Promise<void> {
    if (this.supabase) {
      await this.loadFromSupabase();
      return;
    }

    this.stats = this.loadFromFile();
  }

  async getStats(): Promise<GlobalStats> {
    return this.stats;
  }

  async incrementAttacks(): Promise<GlobalStats> {
    this.stats.totalAttacks += 1;

    if (this.supabase) {
      const { error } = await this.supabase
        .from("global_stats")
        .update({
          total_attacks: this.stats.totalAttacks,
        })
        .eq("id", "global");

      if (error) {
        console.error("Failed to update global stats", error);
      }

      return this.stats;
    }

    this.saveToFile(this.stats);
    return this.stats;
  }

  private loadFromFile(): GlobalStats {
    try {
      const data = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(data) as GlobalStats;
    } catch (e) {
      return { totalAttacks: this.seedValue };
    }
  }

  private saveToFile(stats: GlobalStats): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(stats, null, 2));
    } catch (e) {}
  }

  private async loadFromSupabase(): Promise<void> {
    const supabase = this.supabase;
    if (!supabase) return;

    const { data, error } = await supabase
      .from("global_stats")
      .select("id, total_attacks")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      console.error("Failed to load global stats", error);
      return;
    }

    if (!data) {
      const fallbackStats = this.loadFromFile();
      this.stats = fallbackStats;

      const { error: insertError } = await supabase
        .from("global_stats")
        .insert({ id: "global", total_attacks: this.stats.totalAttacks });

      if (insertError) {
        console.error("Failed to seed global stats", insertError);
      }

      return;
    }

    const row = data as StatsRow;
    this.stats = {
      totalAttacks:
        typeof row.total_attacks === "number"
          ? row.total_attacks
          : this.seedValue,
    };
  }
}
