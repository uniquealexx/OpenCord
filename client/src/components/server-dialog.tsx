"use client";

import { useState } from "react";
import { AlertTriangle, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ru } from "@/lib/i18n/ru";
import { normalizeServerAddress, requiresInsecureHttpConfirmation } from "@/lib/server-address";
import { createId } from "@/lib/utils";
import type { MockServer } from "@/shared/state";

export function ServerDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (server: MockServer) => boolean }): React.ReactElement {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [insecureConfirmed, setInsecureConfirmed] = useState(false);
  const insecureHttp = requiresInsecureHttpConfirmation(address);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    let normalizedAddress: string | null = null;
    try {
      normalizedAddress = normalizeServerAddress(address, { allowInsecureHttp: insecureConfirmed });
    } catch {
      setError(ru.server.invalidAddress);
      return;
    }
    const id = createId("server");
    const serverName = name.trim() || (normalizedAddress ? new URL(normalizedAddress).hostname : "Новое пространство");
    const added = onAdd({
      id,
      name: serverName,
      address: normalizedAddress,
      accent: "#36c5f0",
      channels: [
        { id: `${id}-general`, serverId: id, name: "общий", kind: "text", description: "Основной канал", participantLimit: null },
        { id: `${id}-voice`, serverId: id, name: "Гостиная", kind: "voice", description: "Голос появится позже", participantLimit: 25 },
      ],
      members: [],
    });
    if (!added) { setError(ru.server.duplicateAddress); return; }
    setName(""); setAddress(""); setError(""); setInsecureConfirmed(false); onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-500/12 text-violet-300"><Globe2 className="size-5" /></div>
          <DialogTitle>{ru.server.connectTitle}</DialogTitle>
          <DialogDescription>{ru.server.connectDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.server.name}<Input value={name} onChange={(event) => setName(event.target.value)} placeholder={ru.server.namePlaceholder} maxLength={48} /><span className="text-xs font-normal leading-5 text-slate-500">{ru.server.nameHint}</span></label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.server.address}<Input value={address} onChange={(event) => { setAddress(event.target.value); setError(""); setInsecureConfirmed(false); }} placeholder={ru.server.addressPlaceholder} />{error && <span className="text-xs text-red-300">{error}</span>}</label>
          {insecureHttp && <section className="space-y-3 rounded-2xl border border-red-400/25 bg-red-400/[.07] p-4"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" /><div><h4 className="text-sm font-semibold text-red-200">{ru.server.insecureTitle}</h4><p className="mt-1 text-xs leading-5 text-red-200/65">{ru.server.insecureWarning}</p></div></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-300/15 bg-black/15 p-3 text-xs text-red-100"><input type="checkbox" checked={insecureConfirmed} onChange={(event) => setInsecureConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-red-500" />{ru.server.insecureConfirm}</label></section>}
          <Button type="submit" className="w-full" disabled={insecureHttp && !insecureConfirmed}>{ru.server.submitConnect}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
