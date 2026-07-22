"use client";

import { useState } from "react";
import { Globe2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ru } from "@/lib/i18n/ru";
import { createId } from "@/lib/utils";
import type { MockServer } from "@/shared/state";

export function ServerDialog({ mode, open, onOpenChange, onAdd }: { mode: "create" | "connect"; open: boolean; onOpenChange: (open: boolean) => void; onAdd: (server: MockServer) => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const creating = mode === "create";

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    let normalizedAddress: string | null = null;
    if (!creating) {
      try {
        const parsed = new URL(address);
        const localHttp = parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
        if (parsed.protocol !== "https:" && !localHttp) throw new Error("HTTPS required");
        if (parsed.username || parsed.password) throw new Error("Credentials are not allowed");
        normalizedAddress = parsed.origin;
      } catch {
        setError(ru.server.invalidAddress);
        return;
      }
    }
    const id = createId("server");
    const serverName = name.trim() || (normalizedAddress ? new URL(normalizedAddress).hostname : "Новое пространство");
    onAdd({
      id,
      name: serverName,
      address: normalizedAddress,
      accent: creating ? "#7c5cff" : "#36c5f0",
      channels: [
        { id: `${id}-general`, serverId: id, name: "общий", kind: "text", description: "Основной канал" },
        { id: `${id}-voice`, serverId: id, name: "Гостиная", kind: "voice", description: "Голос появится позже" },
      ],
      members: [],
    });
    setName(""); setAddress(""); setError(""); onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-500/12 text-violet-300">{creating ? <Server className="size-5" /> : <Globe2 className="size-5" />}</div>
          <DialogTitle>{creating ? ru.server.createTitle : ru.server.connectTitle}</DialogTitle>
          <DialogDescription>{creating ? ru.server.createDescription : ru.server.connectDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.server.name}<Input value={name} onChange={(event) => setName(event.target.value)} placeholder={ru.server.namePlaceholder} maxLength={48} required={creating} /></label>
          {!creating && <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.server.address}<Input value={address} onChange={(event) => { setAddress(event.target.value); setError(""); }} placeholder={ru.server.addressPlaceholder} />{error && <span className="text-xs text-red-300">{error}</span>}</label>}
          <Button type="submit" className="w-full">{creating ? ru.server.submitCreate : ru.server.submitConnect}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
