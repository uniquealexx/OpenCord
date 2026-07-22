"use client";

import { useState } from "react";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ru } from "@/lib/i18n/ru";
import type { LocalProfile } from "@/shared/state";

export function Onboarding({ onComplete }: { onComplete: (profile: LocalProfile) => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const valid = name.trim().length >= 2;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    onComplete({ id: "local-user", displayName: name.trim(), bio: bio.trim(), avatar: null, createdAt: new Date().toISOString() });
  }

  return (
    <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#090b12] p-8">
      <div className="pointer-events-none absolute left-[15%] top-[10%] size-80 rounded-full bg-violet-600/15 blur-[110px]" />
      <div className="pointer-events-none absolute bottom-[5%] right-[12%] size-72 rounded-full bg-cyan-500/10 blur-[110px]" />
      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/8 bg-[#10131c]/90 shadow-[0_36px_100px_rgba(0,0,0,.45)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="relative hidden min-h-[610px] overflow-hidden border-r border-white/7 p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(124,92,255,.25),transparent_42%),radial-gradient(circle_at_80%_80%,rgba(54,197,240,.15),transparent_38%)]" />
          <div className="relative"><div className="mb-6 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 text-2xl font-black shadow-[0_18px_60px_rgba(124,92,255,.3)]">O</div><p className="max-w-sm text-4xl font-bold leading-tight tracking-[-.04em] text-white">Общение без чужих правил и закрытых дверей.</p></div>
          <div className="relative grid gap-3 text-sm text-slate-400"><Feature icon={<LockKeyhole />} text="Профиль и настройки хранятся локально" /><Feature icon={<Sparkles />} text="Открытый код и собственные серверы" /></div>
        </div>
        <form onSubmit={submit} className="flex flex-col justify-center p-8 sm:p-12">
          <p className="mb-3 text-xs font-bold uppercase tracking-[.2em] text-violet-300">{ru.onboarding.eyebrow}</p>
          <h1 className="text-3xl font-bold tracking-tight text-white">{ru.onboarding.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">{ru.onboarding.description}</p>
          <div className="mt-8 space-y-5">
            <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.onboarding.name}<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={ru.onboarding.namePlaceholder} maxLength={32} /></label>
            <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.onboarding.bio}<Textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder={ru.onboarding.bioPlaceholder} maxLength={160} /></label>
          </div>
          <Button type="submit" disabled={!valid} className="mt-6 h-12">{ru.onboarding.submit}<ArrowRight className="size-4" /></Button>
          <p className="mt-5 rounded-xl border border-amber-400/10 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200/65">{ru.onboarding.privacy}</p>
        </form>
      </section>
    </main>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }): React.ReactElement {
  return <div className="flex items-center gap-3 rounded-2xl border border-white/7 bg-white/[.035] p-4"><span className="[&>svg]:size-4 text-violet-300">{icon}</span>{text}</div>;
}
