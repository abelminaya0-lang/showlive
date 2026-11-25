import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit3,
  LogOut,
  MailPlus,
  Mic,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  Users,
  XCircle,
} from 'lucide-react';
import {
  deleteAuthorizedClient,
  setClientActiveStatus,
  subscribeAccessLogs,
  subscribeAccessRequests,
  subscribeAllClients,
  updateAccessRequestStatus,
  upsertAuthorizedClient,
} from '../services/firebaseService';
import {
  AccessLog,
  AccessRequest,
  AuthorizedClient,
  CurrencyCode,
} from '../types/showlive';

interface AdminDashboardViewProps {
  adminUid: string;
  adminEmail: string;
  onOpenStudio: () => void;
  onSignOut: () => void;
}

function formatDateTime(ms?: number | null): string {
  if (!ms) return 'Sin entradas aún';
  const d = new Date(ms);
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrencyTotals(clients: AuthorizedClient[]) {
  let pen = 0;
  let usd = 0;
  for (const c of clients) {
    if (c.currency === 'USD') usd += Number(c.amountPaid || 0);
    else pen += Number(c.amountPaid || 0);
  }
  return { pen, usd };
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  adminUid,
  adminEmail,
  onOpenStudio,
  onSignOut,
}) => {
  const [clients, setClients] = useState<AuthorizedClient[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [logs, setLogs] = useState<AccessLog[]>([]);

  // Form state
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [planInput, setPlanInput] = useState('Mensual');
  const [amountInput, setAmountInput] = useState('50');
  const [currencyInput, setCurrencyInput] = useState<CurrencyCode>('PEN');
  const [notesInput, setNotesInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Approval quick amounts per request UID
  const [reqAmounts, setReqAmounts] = useState<Record<string, string>>({});
  const [reqCurrencies, setReqCurrencies] = useState<Record<string, CurrencyCode>>({});

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    const unsubClients = subscribeAllClients(setClients);
    const unsubRequests = subscribeAccessRequests(setRequests);
    const unsubLogs = subscribeAccessLogs(setLogs);
    return () => {
      unsubClients();
      unsubRequests();
      unsubLogs();
    };
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 3200);
    return () => clearTimeout(t);
  }, [feedback]);

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending'),
    [requests]
  );

  const stats = useMemo(() => {
    const activeClients = clients.filter((c) => c.active);
    const totalEntries = clients.reduce((acc, c) => acc + (c.loginCount || 0), 0);
    const enteredClientsCount = clients.filter((c) => (c.loginCount || 0) > 0).length;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEntries = logs.filter(
      (l) => l.enteredAt && l.enteredAt >= todayStart.getTime()
    ).length;

    const totals = formatCurrencyTotals(clients);
    return {
      totalClients: clients.length,
      activeClients: activeClients.length,
      totalEntries,
      enteredClientsCount,
      todayEntries,
      totals,
    };
  }, [clients, logs]);

  const filteredClients = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return clients.filter((c) => {
      const matchFilter =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? c.active : !c.active);
      const matchQuery =
        !q ||
        c.email.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        c.displayName.toLowerCase().includes(q);
      return matchFilter && matchQuery;
    });
  }, [clients, searchTerm, statusFilter]);

  const resetForm = () => {
    setEditingEmail(null);
    setEmailInput('');
    setNameInput('');
    setPlanInput('Mensual');
    setAmountInput('50');
    setCurrencyInput('PEN');
    setNotesInput('');
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    setSaving(true);
    try {
      await upsertAuthorizedClient(adminUid, {
        email: emailInput,
        clientName: nameInput,
        planName: planInput,
        amountPaid: Number(amountInput) || 0,
        currency: currencyInput,
        notes: notesInput,
        active: true,
      });
      setFeedback(
        editingEmail
          ? `Cliente actualizado: ${emailInput.trim().toLowerCase()}`
          : `Acceso activado para: ${emailInput.trim().toLowerCase()}`
      );
      resetForm();
    } catch (err: any) {
      setFeedback(err?.message || 'No se pudo guardar el cliente.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditClient = (client: AuthorizedClient) => {
    setEditingEmail(client.email);
    setEmailInput(client.email);
    setNameInput(client.clientName);
    setPlanInput(client.planName);
    setAmountInput(String(client.amountPaid));
    setCurrencyInput(client.currency);
    setNotesInput(client.notes);
  };

  const handleApproveRequest = async (req: AccessRequest) => {
    const amt = Number(reqAmounts[req.uid] ?? '50') || 0;
    const curr = reqCurrencies[req.uid] || 'PEN';
    await upsertAuthorizedClient(adminUid, {
      email: req.email,
      clientName: req.displayName || req.email.split('@')[0],
      planName: 'Mensual',
      amountPaid: amt,
      currency: curr,
      notes: 'Aprobado desde solicitud Google',
      active: true,
      requestUid: req.uid,
    });
    setFeedback(`Acceso aprobado para ${req.email}`);
  };

  return (
    <div className="min-h-screen w-full bg-[#080A0F] text-slate-100 flex flex-col">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-20 bg-[#090B10]/95 backdrop-blur border-b border-white/10 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F4256A] to-[#BE123C] flex items-center justify-center shadow-lg shadow-[#F4256A]/25">
            <Mic className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-base sm:text-lg font-extrabold text-white leading-none">
                Show<span className="text-[#F4256A]">Live</span> · Panel Personal
              </h1>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
                Admin
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">{adminEmail}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenStudio}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#F4256A] hover:bg-[#FF3478] text-white text-xs font-bold cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Abrir Consola ShowLive</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#131722] hover:bg-[#1B2030] border border-white/10 text-slate-300 text-xs font-medium cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1440px] mx-auto p-4 sm:p-6 space-y-6">
        {feedback && (
          <div className="px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs font-semibold text-emerald-200">
            {feedback}
          </div>
        )}

        {/* KPI Summary Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl bg-[#0D1018] border border-white/10 p-4 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Total Ganado
              </p>
              <div className="mt-2 space-y-0.5">
                <p className="font-display text-2xl font-extrabold text-emerald-400 font-mono-tabular">
                  S/ {stats.totals.pen.toFixed(2)}
                </p>
                {stats.totals.usd > 0 && (
                  <p className="text-sm font-bold text-cyan-300 font-mono-tabular">
                    + $ {stats.totals.usd.toFixed(2)} USD
                  </p>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Acumulado de {stats.totalClients} cliente(s)
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
          </div>

          <div className="rounded-xl bg-[#0D1018] border border-white/10 p-4 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Clientes con Acceso
              </p>
              <p className="font-display text-2xl font-extrabold text-white mt-2 font-mono-tabular">
                {stats.activeClients}{' '}
                <span className="text-sm font-normal text-slate-400">
                  / {stats.totalClients}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Activos autorizados por correo
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          <div className="rounded-xl bg-[#0D1018] border border-white/10 p-4 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Cuántos han entrado
              </p>
              <p className="font-display text-2xl font-extrabold text-[#F4256A] mt-2 font-mono-tabular">
                {stats.enteredClientsCount}{' '}
                <span className="text-sm font-normal text-slate-300">
                  clientes ({stats.totalEntries} accesos)
                </span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {stats.todayEntries} entrada(s) registradas hoy
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-[#F4256A]/15 border border-[#F4256A]/30 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-[#F4256A]" />
            </div>
          </div>

          <div className="rounded-xl bg-[#0D1018] border border-white/10 p-4 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Solicitudes Pendientes
              </p>
              <p className="font-display text-2xl font-extrabold text-amber-400 mt-2 font-mono-tabular">
                {pendingRequests.length}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Esperando tu aprobación
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
          </div>
        </section>

        {/* Pending Requests Banner */}
        {pendingRequests.length > 0 && (
          <section className="rounded-xl bg-[#111420] border border-amber-500/35 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <h2 className="font-display text-sm font-bold text-white">
                Solicitudes de Acceso ({pendingRequests.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingRequests.map((req) => (
                <div
                  key={req.uid}
                  className="rounded-lg bg-[#0A0C12] border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {req.photoURL ? (
                      <img
                        src={req.photoURL}
                        alt={req.displayName}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs font-bold shrink-0">
                        {req.email[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {req.displayName || 'Usuario Google'}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{req.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min={0}
                      value={reqAmounts[req.uid] ?? '50'}
                      onChange={(e) =>
                        setReqAmounts((p) => ({ ...p, [req.uid]: e.target.value }))
                      }
                      className="w-16 px-2 py-1 rounded bg-[#141824] border border-white/15 text-xs text-white"
                      title="Monto cobrado"
                    />
                    <select
                      value={reqCurrencies[req.uid] || 'PEN'}
                      onChange={(e) =>
                        setReqCurrencies((p) => ({
                          ...p,
                          [req.uid]: e.target.value as CurrencyCode,
                        }))
                      }
                      className="px-1.5 py-1 rounded bg-[#141824] border border-white/15 text-xs text-slate-200"
                    >
                      <option value="PEN">S/</option>
                      <option value="USD">$</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleApproveRequest(req)}
                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                    >
                      Aprobar
                    </button>
                    <button
                      type="button"
                      onClick={() => updateAccessRequestStatus(req.uid, 'rejected')}
                      className="p-1 rounded bg-[#151926] hover:bg-red-600/30 text-slate-400 hover:text-red-300 cursor-pointer"
                      title="Rechazar"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Main 2-Column Area: Add/Grant Access Form + Clients Table + Activity */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Grant Access by Email */}
          <div className="lg:col-span-4 space-y-5">
            <form
              onSubmit={handleSaveClient}
              className="rounded-xl bg-[#0D1018] border border-white/10 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MailPlus className="w-4 h-4 text-[#F4256A]" />
                  <h2 className="font-display text-sm font-bold text-white">
                    {editingEmail ? 'Editar Cliente' : 'Dar Acceso por Correo'}
                  </h2>
                </div>
                {editingEmail && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Correo Google del cliente *
                </label>
                <input
                  type="email"
                  required
                  disabled={Boolean(editingEmail)}
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="cliente@gmail.com"
                  className="w-full px-3 py-2 rounded-lg bg-[#131722] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F4256A] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Nombre / DJ / Artista
                </label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Ej: DJ Carlos Perú"
                  className="w-full px-3 py-2 rounded-lg bg-[#131722] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F4256A]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Plan
                  </label>
                  <select
                    value={planInput}
                    onChange={(e) => setPlanInput(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg bg-[#131722] border border-white/10 text-xs text-white focus:outline-none focus:border-[#F4256A]"
                  >
                    <option value="Mensual">Mensual</option>
                    <option value="Trimestral">Trimestral</option>
                    <option value="Anual">Anual</option>
                    <option value="Vitalicio">Vitalicio</option>
                    <option value="Evento">Evento</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Monto
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#131722] border border-white/10 text-xs text-white focus:outline-none focus:border-[#F4256A]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Moneda
                  </label>
                  <select
                    value={currencyInput}
                    onChange={(e) => setCurrencyInput(e.target.value as CurrencyCode)}
                    className="w-full px-2 py-2 rounded-lg bg-[#131722] border border-white/10 text-xs text-white focus:outline-none focus:border-[#F4256A]"
                  >
                    <option value="PEN">PEN (S/)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Notas / Pago
                </label>
                <input
                  type="text"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Ej: Pagó por Yape / Plin"
                  className="w-full px-3 py-2 rounded-lg bg-[#131722] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F4256A]"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#F4256A] to-[#E11D48] hover:from-[#FF3478] hover:to-[#F4256A] disabled:opacity-60 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                {saving
                  ? 'Guardando...'
                  : editingEmail
                    ? 'Guardar Cambios'
                    : 'Dar Acceso Ahora'}
              </button>
            </form>

            {/* Recent Login Activity */}
            <div className="rounded-xl bg-[#0D1018] border border-white/10 p-4 space-y-3">
              <h3 className="font-display text-sm font-bold text-white">
                Últimas Entradas de Clientes
              </h3>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {logs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    Aún no hay entradas registradas.
                  </p>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#121622] border border-white/5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {log.displayName || log.email}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">{log.email}</p>
                      </div>
                      <span className="text-[10px] font-mono-tabular text-cyan-300 shrink-0">
                        {formatDateTime(log.enteredAt)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Clients Table */}
          <div className="lg:col-span-8 rounded-xl bg-[#0D1018] border border-white/10 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-sm font-bold text-white">
                Mis Clientes ({filteredClients.length})
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar correo o nombre..."
                    className="pl-8 pr-3 py-1.5 w-48 rounded-lg bg-[#131722] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F4256A]"
                  />
                </div>

                <div className="flex rounded-lg bg-[#131722] border border-white/10 p-0.5 text-[11px]">
                  {(
                    [
                      ['all', 'Todos'],
                      ['active', 'Activos'],
                      ['inactive', 'Suspendidos'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStatusFilter(val)}
                      className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors ${
                        statusFilter === val
                          ? 'bg-[#F4256A] text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {filteredClients.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  No hay clientes en esta vista. Agrega un correo a la izquierda para darle acceso.
                </div>
              ) : (
                filteredClients.map((c) => (
                  <div
                    key={c.email}
                    className="p-3.5 hover:bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {c.photoURL ? (
                        <img
                          src={c.photoURL}
                          alt={c.clientName || c.email}
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-full object-cover shrink-0 border border-white/10"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#191F30] border border-white/10 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                          {(c.clientName || c.email)[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold text-white truncate">
                            {c.clientName || c.displayName || c.email}
                          </p>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              c.active
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-red-500/15 text-red-300 border border-red-500/30'
                            }`}
                          >
                            {c.active ? 'Activo' : 'Suspendido'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-300">
                            {c.planName}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{c.email}</p>
                        {c.notes && (
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {c.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-left sm:text-right">
                        <p className="text-xs font-bold text-emerald-400 font-mono-tabular">
                          {c.currency === 'USD' ? '$' : 'S/'}{' '}
                          {Number(c.amountPaid || 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono-tabular">
                          {c.loginCount} entrada(s) ·{' '}
                          {c.lastLoginAt ? formatDateTime(c.lastLoginAt) : 'Aún no entra'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setClientActiveStatus(c.email, !c.active)}
                          className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                            c.active
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                          }`}
                          title={c.active ? 'Suspender acceso' : 'Reactivar acceso'}
                        >
                          {c.active ? (
                            <UserX className="w-3.5 h-3.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleEditClient(c)}
                          className="p-1.5 rounded-lg bg-[#141824] hover:bg-[#1E2436] border border-white/10 text-slate-300 cursor-pointer"
                          title="Editar cliente / monto"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            deleteAuthorizedClient(c.email);
                            setFeedback(`Cliente eliminado: ${c.email}`);
                          }}
                          className="p-1.5 rounded-lg bg-[#141824] hover:bg-red-600/25 border border-white/10 hover:border-red-500/40 text-slate-400 hover:text-red-300 cursor-pointer"
                          title="Eliminar cliente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
