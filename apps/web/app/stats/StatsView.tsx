'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { serverHttpUrl } from '@/lib/serverHttp';
import { clock, secondsLeft, useNow } from '@/lib/useNow';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/Panel';
import { PageFrame, SiteHeader } from '@/components/Brand';

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
  /** Set when stakes are test tokens in GameVault rather than points. */
  onchain?: boolean;
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
    /** Points only: the vault doesn't keep this per epoch. */
    toDailyPool?: number;
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

  const unit = pool?.onchain ? 'tBON' : 'pts';
  const personas = Object.values(stats?.personas ?? {}).sort(
    (a, b) => b.fooled / (b.judged || 1) - a.fooled / (a.judged || 1),
  );

  return (
    <PageFrame className="max-w-2xl gap-6">
      <SiteHeader page="stats">
        <Link href="/" className="eyebrow transition-colors hover:text-foreground">
          Play
        </Link>
      </SiteHeader>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {stats && (
        <Panel crosshairs className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <Tile label="Rounds" value={stats.rounds} />
          <Tile label="Bot rounds" value={stats.botRounds} />
          <Tile label="Bots fooled people" value={pct(stats.botFoolRate)} />
          <Tile label="Humans fooled people" value={pct(stats.humanFoolRate)} />
          <Tile label="Human rounds" value={stats.humanRounds} />
          <Tile label="Bot fallbacks" value={stats.fallbacks} />
          <Tile label="Void rounds" value={stats.voids} />
          <Tile label="No-calls" value={stats.calls.noCall} />
        </Panel>
      )}

      {pool && (
        <Panel className="p-5 text-sm">
          <h2 className="eyebrow">Payout pool</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Pool #{pool.epoch} closes in {clock(secondsLeft(pool.epochEndsAt, now))} with{' '}
            {pool.pendingCalls} {pool.pendingCalls === 1 ? 'call' : 'calls'} so far. Daily pool:{' '}
            <strong className="font-mono font-medium text-foreground">
              {pool.dailyPool} {unit}
            </strong>
            . Fees collected: {pool.feesCollected} {unit}.
          </p>
          {pool.lastSettlement && (
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Last settled pool #{pool.lastSettlement.epoch}: {pool.lastSettlement.rightCalls} right
              and {pool.lastSettlement.wrongCalls} wrong, +{pool.lastSettlement.profitPerRight} per
              right call, {pool.lastSettlement.deceptionPaid} paid for deception
              {pool.lastSettlement.toDailyPool !== undefined &&
                `, ${pool.lastSettlement.toDailyPool} to the daily pool`}
              .
            </p>
          )}
        </Panel>
      )}

      {stats && (
        <Panel className="p-5 text-sm">
          <h2 className="eyebrow">Bots</h2>
          {personas.length === 0 ? (
            <p className="mt-3 text-muted-foreground">No bot rounds yet.</p>
          ) : (
            <table className="mt-3 w-full text-left">
              <thead className="eyebrow">
                <tr>
                  <th className="py-1 font-medium">Persona</th>
                  <th className="py-1 text-right font-medium">Rounds</th>
                  <th className="py-1 text-right font-medium">Calls</th>
                  <th className="py-1 text-right font-medium">Fooled</th>
                </tr>
              </thead>
              <tbody>
                {personas.map((p) => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="py-2">
                      {p.name}
                      {p.trickster && <Badge className="ml-2">trickster</Badge>}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{p.rounds}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{p.judged}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {p.judged ? pct(p.fooled / p.judged) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </PageFrame>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-mono text-2xl tabular-nums">{value}</p>
    </div>
  );
}
