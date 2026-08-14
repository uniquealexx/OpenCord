"use client";

import { useEffect, useState } from "react";
import { ArrowRight, AtSign, LockKeyhole, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LANGUAGE_LABELS, LANGUAGES, useI18n, type Language } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { randomDiscriminator, type LocalProfile } from "@/shared/state";

export function Onboarding({ language, onLanguageChange, onComplete }: { language: Language; onLanguageChange: (language: Language) => void; onComplete: (profile: LocalProfile) => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [bio, setBio] = useState("");
  const [discriminator, setDiscriminator] = useState<string | null>(null);
  const { t } = useI18n();
  const usernameValid = /^[a-z0-9_.-]{2,32}$/u.test(username.trim().toLowerCase());
  const valid = name.trim().length >= 2 && usernameValid;

  useEffect(() => {
    void window.openCord?.identity?.getOrCreate().then((identity) => setDiscriminator(identity.discriminator)).catch(() => setDiscriminator(null));
  }, []);

  function changeName(value: string): void {
    setName(value);
    if (!usernameTouched) setUsername(slugifyUsername(value));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
    let nextDiscriminator = discriminator;
    if (!nextDiscriminator) {
      try { nextDiscriminator = (await window.openCord?.identity?.getOrCreate())?.discriminator ?? null; } catch { nextDiscriminator = null; }
    }
    // В браузере без моста идентичности (демо-режим) дискриминатор генерируется локально.
    onComplete({ id: "local-user", username: username.trim().toLowerCase(), discriminator: nextDiscriminator ?? randomDiscriminator(), displayName: name.trim(), bio: bio.trim(), avatar: null, banner: null, createdAt: new Date().toISOString() });
  }

  return (
    <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-canvas p-4 sm:p-8 max-sm:block max-sm:overflow-y-auto">
      <div role="group" aria-label={t.onboarding.language} className="mb-4 grid w-full grid-cols-3 gap-1 rounded-xl border border-white/8 bg-white/[.04] p-1 sm:absolute sm:right-5 sm:top-5 sm:mb-0 sm:flex sm:w-auto sm:items-center">
        {LANGUAGES.map((option) => (
          <button key={option} type="button" aria-pressed={language === option} onClick={() => onLanguageChange(option)} className={cn("rounded-lg px-2.5 py-2 text-center text-xs font-semibold transition sm:px-3 sm:py-1.5", language === option ? "bg-violet-500 text-white" : "text-slate-500 hover:text-slate-200")}>{LANGUAGE_LABELS[option]}</button>
        ))}
      </div>
      <section className="glass relative w-full max-w-5xl overflow-hidden rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,.45)] lg:grid-cols-[1.05fr_.95fr] max-sm:bg-transparent max-sm:shadow-none sm:grid">
        <div className="relative hidden min-h-[610px] overflow-hidden border-r border-white/10 p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="relative"><div className="mb-6 grid size-14 place-items-center rounded-xl bg-primary text-2xl font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,.4)]">O</div><p className="max-w-sm text-4xl font-bold leading-tight tracking-[-.04em] text-white">{t.onboarding.hero}</p></div>
          <div className="relative grid gap-3 text-sm text-slate-400"><Feature icon={<LockKeyhole />} text={t.onboarding.featureProfile} /><Feature icon={<Sparkles />} text={t.onboarding.featureOpen} /></div>
        </div>
        <form onSubmit={submit} className="flex flex-col justify-center p-5 sm:p-12">
          <p className="mb-3 text-xs font-bold uppercase tracking-[.2em] text-violet-300">{t.onboarding.eyebrow}</p>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{t.onboarding.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">{t.onboarding.description}</p>
          <div className="mt-8 space-y-5">
            <label className="grid gap-2 text-sm font-medium text-slate-300">{t.onboarding.name}<Input autoFocus value={name} onChange={(event) => changeName(event.target.value)} placeholder={t.onboarding.namePlaceholder} maxLength={32} /></label>
            <label className="grid gap-2 text-sm font-medium text-slate-300">{t.onboarding.username}<Input value={username} onChange={(event) => { setUsername(event.target.value); setUsernameTouched(true); }} placeholder="username" maxLength={32} className={username && !usernameValid ? "border-red-400/60" : ""} /></label>
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><AtSign className="size-3.5" />{t.onboarding.usernameHint}</p>
            <label className="grid gap-2 text-sm font-medium text-slate-300">{t.onboarding.bio}<Textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder={t.onboarding.bioPlaceholder} maxLength={160} /></label>
            {usernameValid && <p className="rounded-xl border border-violet-400/15 bg-violet-400/[.05] px-4 py-2.5 text-xs text-violet-200/80">{t.onboarding.tagPreview}<span className="font-semibold text-violet-100">{username.trim().toLowerCase()}#{discriminator ?? t.onboarding.tagPending}</span></p>}
          </div>
          <Button type="submit" disabled={!valid} className="mt-6 h-12">{t.onboarding.submit}<ArrowRight className="size-4" /></Button>
          <p className="mt-5 rounded-xl border border-amber-400/10 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200/65">{t.onboarding.privacy}</p>
        </form>
      </section>
    </main>
  );
}

function slugifyUsername(displayName: string): string {
  const slug = displayName.toLocaleLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 32);
  return slug.length >= 2 ? slug : "user";
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }): React.ReactElement {
  return <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.04] p-4"><span className="[&>svg]:size-4 text-violet-300">{icon}</span>{text}</div>;
}
