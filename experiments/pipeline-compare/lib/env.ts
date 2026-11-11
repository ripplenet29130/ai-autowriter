export function env(name: string, fallback = ''): string {
  return (Deno.env.get(name) ?? '').trim() || fallback;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} が設定されていません。experiments/pipeline-compare/.env に入れてください。`);
  }
  return value;
}

export function envNumber(name: string): number | null {
  const raw = env(name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// 工程ごとの所要時間を記録する
export class StepTimer {
  readonly steps: Array<{ name: string; ms: number; note?: string }> = [];
  private readonly start = Date.now();

  async time<T>(name: string, fn: () => Promise<T>, note?: (result: T) => string | undefined): Promise<T> {
    const started = Date.now();
    console.log(`  ▶ ${name}`);
    try {
      const result = await fn();
      const ms = Date.now() - started;
      const text = note?.(result);
      this.steps.push({ name, ms, ...(text ? { note: text } : {}) });
      console.log(`  ✓ ${name}（${(ms / 1000).toFixed(1)}秒）${text ? ` ${text}` : ''}`);
      return result;
    } catch (error) {
      const ms = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      this.steps.push({ name, ms, note: `失敗: ${message.slice(0, 200)}` });
      console.log(`  ✗ ${name}（${(ms / 1000).toFixed(1)}秒）${message.slice(0, 200)}`);
      throw error;
    }
  }

  skip(name: string, reason: string): void {
    this.steps.push({ name, ms: 0, note: `省略: ${reason}` });
    console.log(`  - ${name} 省略: ${reason}`);
  }

  get totalMs(): number {
    return Date.now() - this.start;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}
