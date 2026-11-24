import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cx } from '../../lib/format';

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'success';
const VARIANTS: Record<Variant, string> = {
  default: 'bg-surface-2 border-border text-fg hover:border-muted',
  primary: 'bg-primary/15 border-primary/50 text-primary hover:bg-primary/25',
  success: 'bg-success text-white border-success hover:brightness-110',
  danger: 'bg-danger/10 border-danger/50 text-danger hover:bg-danger/20',
  ghost: 'bg-transparent border-transparent text-muted hover:text-fg hover:bg-surface-2',
};
export function Button({ variant = 'default', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon'; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : size === 'icon' ? 'h-8 w-8' : 'h-8 px-3 text-sm', VARIANTS[variant], className)}>
      {loading && <Loader2 className="size-3.5 animate-spin" />}{children}
    </button>
  );
}

export function Card({ className, children, title, actions, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{title}</h2>{subtitle && <p className="text-xs text-muted">{subtitle}</p>}</div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' | 'library'; children: ReactNode; className?: string; icon?: ReactNode }) {
  const t = { neutral: 'border-border text-muted', success: 'border-success/40 text-success bg-success/10', warning: 'border-warning/40 text-warning bg-warning/10', danger: 'border-danger/40 text-danger bg-danger/10', primary: 'border-primary/40 text-primary bg-primary/10', library: 'border-library/40 text-library bg-library/10' }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', t, className)}>{icon}{children}</span>;
}

const hasWidth = (c?: string) => !!c && /(^|\s)(w-|min-w-|flex-1)/.test(c);
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx('h-8 rounded-md', !hasWidth(className) && 'w-full', 'border border-border bg-bg px-2.5 text-sm outline-none placeholder:text-muted/70 focus:border-primary', className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx('w-full rounded-md border border-border bg-bg px-2.5 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-primary', className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx('h-8 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-primary', className)}>{children}</select>;

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cx('block space-y-1', className)}><span className="text-xs font-medium text-muted">{label}</span>{children}{hint && <span className="block text-xs text-muted/80">{hint}</span>}</label>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'opacity-50')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full border transition-colors', checked ? 'border-success bg-success' : 'border-border bg-surface-2')}>
        <span className={cx('absolute top-0.5 size-3.5 rounded-full bg-white transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={cx('m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl', wide ? 'max-w-4xl' : 'max-w-xl')}>
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-5 py-3"><h2 className="font-semibold">{title}</h2><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="size-4" /></Button></header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm', value === t.id ? 'border-warning font-semibold text-fg' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}{t.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted">{icon}<p className="font-medium text-fg">{title}</p>{children && <div className="max-w-md text-sm">{children}</div>}</div>;
}
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('size-4 animate-spin text-muted', className)} />;
export function Loading({ label = 'Loading…' }: { label?: string }) { return <div className="flex items-center gap-2 p-6 text-sm text-muted"><Spinner />{label}</div>; }

export function Stat({ label, value, hint, tone, icon, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'primary'; icon?: ReactNode; onClick?: () => void }) {
  const color = tone ? { success: 'text-success', warning: 'text-warning', danger: 'text-danger', primary: 'text-primary' }[tone] : 'text-fg';
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="rounded-xl border border-border bg-surface p-4 text-left transition-colors enabled:hover:border-muted disabled:cursor-default">
      <div className="flex items-center justify-between text-xs text-muted">{label}{icon}</div>
      <div className={cx('mt-1 text-3xl font-semibold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </button>
  );
}

// ---- Toasts
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-4), { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100%-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm shadow-xl">
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : t.tone === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /> : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
            <span className="min-w-0 break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Wrap an async action with loading state and error toasts. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(key);
    try { const r = await fn(); if (success) toast('success', success); return r; }
    catch (e) { toast('error', (e as Error).message); return undefined; }
    finally { setBusy(null); }
  }, [toast]);
  return { busy, run };
}
