import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Server, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Trash2, 
  Plus, 
  Sparkles, 
  Zap, 
  ShieldCheck, 
  Cpu, 
  Clock,
  Layers
} from 'lucide-react';

interface DbHealth {
  status: 'ok' | 'error';
  version?: string;
  database?: string;
  user?: string;
  branch: string;
  isPooled: boolean;
  latencyMs: number;
  error?: string;
}

interface Item {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
}

export default function App() {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch Health Check
  const checkHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealth(data);
    } catch (err: unknown) {
      setHealth({
        status: 'error',
        branch: 'production',
        isPooled: true,
        latencyMs: 0,
        error: err instanceof Error ? err.message : 'Hitilafu ya muunganisho wa server',
      });
    } finally {
      setLoadingHealth(false);
    }
  };

  // Fetch Items from Neon Postgres
  const loadItems = async () => {
    setLoadingItems(true);
    try {
      const res = await fetch('/api/items');
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    checkHealth();
    loadItems();
  }, []);

  // Create new item in Neon Postgres
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      });
      const data = await res.json();
      if (data.success) {
        setTitle('');
        setDescription('');
        setFeedback({ type: 'success', message: 'Kumbukumbu imehifadhiwa kikamilifu kwenye Neon Postgres!' });
        loadItems();
        checkHealth();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Hitilafu wakati wa kuhifadhi' });
      }
    } catch (err: unknown) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Hitilafu ya mtandao' });
    } finally {
      setSubmitting(false);
    }
  };

  // Delete item from Neon Postgres
  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Seed sample records
  const handleSeed = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', message: `Sampuli ${data.count} zimeingizwa kwenye Neon Postgres!` });
        loadItems();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-slate-950">
              <Database className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Neon Postgres</h1>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Imewashwa (Active)
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Mradi: <span className="text-slate-300 font-mono">falling-moon-75342440</span> | Tawi: <span className="text-emerald-400 font-mono">production</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { checkHealth(); loadItems(); }}
              disabled={loadingHealth || loadingItems}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800/80 text-xs font-medium text-slate-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth || loadingItems ? 'animate-spin text-emerald-400' : ''}`} />
              Onyesha Upya
            </button>
            <button
              onClick={handleSeed}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Weka Data ya Sampuli
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Status & Diagnostics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Card 1: Connection Status */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">Hali ya Muunganisho</span>
              {health?.status === 'ok' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-rose-400" />
              )}
            </div>
            <div className="text-2xl font-bold tracking-tight text-white mb-1">
              {health?.status === 'ok' ? 'Imeunganishwa' : 'Hitilafu'}
            </div>
            <p className="text-xs text-slate-400">
              {health?.status === 'ok' ? 'Hifadhidata inafanya kazi barabara' : health?.error || 'Inajaribu kuunganisha...'}
            </p>
          </div>

          {/* Card 2: Latency */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">Kasi ya Majibu (Ping)</span>
              <Clock className="w-5 h-5 text-teal-400" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-emerald-400 mb-1 font-mono">
              {health?.latencyMs !== undefined ? `${health.latencyMs} ms` : '--'}
            </div>
            <p className="text-xs text-slate-400">Muda wa jibu kutoka Neon Cloud</p>
          </div>

          {/* Card 3: Connection Type */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">Mfumo wa Muunganisho</span>
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-white mb-1">
              {health?.isPooled ? 'Pooled' : 'Direct'}
            </div>
            <p className="text-xs text-slate-400">
              {health?.isPooled ? 'PgBouncer Pooler (Haraka)' : 'Muunganisho wa Moja kwa Moja'}
            </p>
          </div>

          {/* Card 4: Database & User */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">Hifadhidata & Mtumiaji</span>
              <ShieldCheck className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="text-lg font-bold tracking-tight text-white font-mono truncate mb-1">
              {health?.database || 'neondb'}
            </div>
            <p className="text-xs text-slate-400 truncate">
              Mtumiaji: <span className="font-mono text-slate-300">{health?.user || 'neondb_owner'}</span>
            </p>
          </div>
        </div>

        {/* Database Diagnostic Details Accordion/Panel */}
        {health?.version && (
          <div className="bg-slate-900/50 border border-slate-800/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <Server className="w-4 h-4 text-emerald-400" />
              <span>Toleo la Postgres:</span>
              <span className="font-mono text-slate-200">{health.version.split(' on ')[0]}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Dereva (Driver):</span>
              <span className="font-mono text-emerald-400 font-semibold">@neondatabase/serverless</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Cpu className="w-4 h-4 text-purple-400" />
              <span>Eneo (Region):</span>
              <span className="font-mono text-slate-200">aws-eu-central-1</span>
            </div>
          </div>
        )}

        {/* Feedback message */}
        {feedback && (
          <div
            className={`p-4 rounded-xl text-xs font-medium flex items-center justify-between border ${
              feedback.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
            }`}
          >
            <span>{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white ml-2 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* Two Column Layout: Add Item Form + Items List */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Form to Add Record */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl sticky top-24">
              <div className="flex items-center gap-2 mb-4">
                <Plus className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-white">Ongeza Kumbukumbu Mpya</h2>
              </div>
              <p className="text-xs text-slate-400 mb-6">
                Data hii inahifadhiwa moja kwa moja kwenye jedwali la <code className="text-emerald-400 font-mono">neon_items</code> kwenye Neon Postgres.
              </p>

              <form onSubmit={handleAddItem} className="space-y-4">
                <div>
                  <label htmlFor="item-title" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Kichwa cha Habari (Title) *
                  </label>
                  <input
                    id="item-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Mfano: Ripoti ya Mauzo"
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                <div>
                  <label htmlFor="item-desc" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Maelezo (Description)
                  </label>
                  <textarea
                    id="item-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Maelezo ya ziada..."
                    rows={3}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !title.trim()}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-slate-950 font-semibold rounded-xl text-xs tracking-wide transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Database className="w-4 h-4" />
                  {submitting ? 'Inahifadhi...' : 'Hifadhi kwenye Neon'}
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: Live Data from Neon */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Kumbukumbu Zilizopo</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-slate-800 text-slate-300">
                  {items.length}
                </span>
              </div>
              <span className="text-xs text-slate-500">
                Jedwali: <span className="font-mono text-slate-400">public.neon_items</span>
              </span>
            </div>

            {loadingItems ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800/60">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400 mx-auto mb-3" />
                <p className="text-xs text-slate-400">Inasoma data kutoka Neon Postgres...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-8">
                <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300 mb-1">Hakuna kumbukumbu bado</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
                  Jedwali la Neon Postgres liko wazi. Ongeza kumbukumbu mpya au bofya kitufe cha kuweka data ya sampuli.
                </p>
                <button
                  onClick={handleSeed}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-emerald-400 border border-slate-700 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Weka Data ya Sampuli Sasa
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="group bg-slate-900/90 border border-slate-800/80 hover:border-slate-700/80 rounded-xl p-4 transition-all flex items-start justify-between gap-4 shadow-sm"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-emerald-400 font-semibold">
                          #{item.id}
                        </span>
                        <h4 className="text-sm font-semibold text-white truncate">
                          {item.title}
                        </h4>
                      </div>
                      {item.description && (
                        <p className="text-xs text-slate-400 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      <div className="text-[11px] text-slate-500 pt-1 font-mono">
                        {new Date(item.created_at).toLocaleString('sw-KE', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(item.id)}
                      title="Futa kumbukumbu hii"
                      className="opacity-60 group-hover:opacity-100 p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
