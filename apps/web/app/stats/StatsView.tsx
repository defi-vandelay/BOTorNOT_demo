'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { serverHttpUrl } from '@/lib/serverHttp';
import { clock, secondsLeft, useNow } from '@/lib/useNow';

interface PersonaRow {
  name: string;
  trickster: boolean;
  rounds: number;
  judged: number;
  fooled: number;
}

interface StatsJson {
  rounds: number;
  humanRounds: number;
  botRounds: number;
  fallbacks: number;
  voids: number;
  calls: { noCall: number };
  botFoolRate: number | null;
  humanFoolRate: number | null;
  personas: Record<string, PersonaRow>;
}

interface PoolJson {
  epoch: number;
  epochEndsAt: number;
  pendingCalls: number;
  dailyPool: number;
  feesCollected: number;
  lastSettlement?: {
    epoch: number;
    rightCalls: number;
    wrongCalls: number;
    profitPerRight: number;
    deceptionPaid: number;
    toDailyPool: number;
  };
}

const REFRESH_MS = 5_000;
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

/** Live game statistics from the server's /stats and /pool, refreshed every few seconds. */
export function StatsView() {
  const [stats, setStats] = useState<StatsJson | null>(null);
  const [pool, setPool] = useState<PoolJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1_000);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, p] = await Promise.all([
          fetch(serverHttpUrl('/stats')).then((r) => r.json() as Promise<StatsJson>),
          fetch(serverHttpUrl('/pool')).then((r) => r.json() as Promise<PoolJson>),
        ]);
        if (!alive) return;
        setStats(s);
        setPool(p);
        setError(null);
      } catch {
        if (alive) setError('Can’t reach the game server. Is it running?');
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const personas = Object.values(stats?.personas ?? {}).sort(
    (a, b) => b.fooled / (b.judged || 1) - a.fooled / (a.judged || 1),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-black tracking-tight">
          BOT <span className="text-[var(--muted)]">or</span> NOT{' '}
          <span className="font-semibold text-[var(--muted)]">stats</span>
        </h1>
        <Link href="/" className="text-sm text-[var(--muted)] underline">
          Play
        </Link>
      </header>

      {error && (
        <p className="text-sm text-[var(--bot)]" role="alert">
          {error}
        </p>
      )}

      {stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Rounds" value={stats.rounds} />
          <Tile label="Bot rounds" value={stats.botRounds} />
          <Tile label="Bots fooled people" value={pct(stats.botFoolRate)} />
          <Tile label="Humans fooled people" value={pct(stats.humanFoolRate)} />
          <Tile label="Human rounds" value={stats.humanRounds} />
          <Tile label="Bot fallbacks" value={stats.fallbacks} />
          <Tile label="Void rounds" value={stats.voids} />
          <Tile label="No-calls" value={stats.calls.noCall} />
        </section>
      )}

      {pool && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
          <h2 className="font-semibold">Payout pool</h2>
          <p className="mt-2 text-[var(--muted)]">
            Pool #{pool.epoch} closes in {clock(secondsLeft(pool.epochEndsAt, now))} with{' '}
            {pool.pendingCalls} {pool.pendingCalls === 1 ? 'call' : 'calls'} so far. Daily pool:{' '}
            <strong className="text-[var(--fg)]">{pool.dailyPool} pts</strong>. Fees collected:{' '}
            {pool.feesCollected} pts.
          </p>
          {pool.lastSettlement && (
            <p className="mt-2 text-[var(--muted)]">
              Last settled pool #{pool.lastSettlement.epoch}: {pool.lastSettlement.rightCalls} right
              and {pool.lastSettlement.wrongCalls} wrong, +{pool.lastSettlement.profitPerRight} per
              right call, {pool.lastSettlement.deceptionPaid} paid for deception,{' '}
              {pool.lastSettlement.toDailyPool} to the daily pool.
            </p>
          )}
        </section>
      )}

      {stats && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
          <h2 className="font-semibold">Bots</h2>
          {personas.length === 0 ? (
            <p className="mt-2 text-[var(--muted)]">No bot rounds yet.</p>
          ) : (
            <table className="mt-3 w-full text-left">
              <thead className="text-xs text-[var(--muted)]">
                <tr>
                  <th className="py-1 font-medium">Persona</th>
                  <th className="py-1 text-right font-medium">Rounds</th>
                  <th className="py-1 text-right font-medium">Calls</th>
                  <th className="py-1 text-right font-medium">Fooled</th>
                </tr>
              </thead>
              <tbody>
                {personas.map((p) => (
                  <tr key={p.name} className="border-t border-[var(--border)]">
                    <td className="py-1.5">
                      {p.name}
                      {p.trickster && (
                        <span className="ml-2 rounded-full bg-[var(--bubble-them)] px-2 py-0.5 text-xs">
                          trickster
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{p.rounds}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.judged}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.judged ? pct(p.fooled / p.judged) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}
