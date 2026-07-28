"use client";

import { useState } from "react";
import { Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ru } from "@/lib/i18n/ru";
import { normalizeServerAddress } from "@/lib/server-address";
import { createId } from "@/lib/utils";
import type { MockServer } from "@/shared/state";

export function ServerDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (server: MockServer) => boolean }): React.ReactElement {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    let normalizedAddress: string | null = null;
    try {
      normalizedAddress = normalizeServerAddress(address);
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
    setName(""); setAddress(""); setError(""); onOpenChange(false);
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
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.server.address}<Input value={address} onChange={(event) => { setAddress(event.target.value); setError(""); }} placeholder={ru.server.addressPlaceholder} />{error && <span className="text-xs text-red-300">{error}</span>}</label>
          <Button type="submit" className="w-full">{ru.server.submitConnect}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
