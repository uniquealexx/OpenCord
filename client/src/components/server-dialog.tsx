"use client";

import { useState } from "react";
import { DEFAULT_ATTACHMENT_LIMIT_BYTES, DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE, DEFAULT_SCREEN_SHARE_MAX_RESOLUTION } from "@opencord/shared";
import { AlertTriangle, Globe2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { normalizeServerAddress, requiresInsecureHttpConfirmation } from "@/lib/server-address";
import { createId } from "@/lib/utils";
import type { MockServer } from "@/shared/state";

export function ServerDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (server: MockServer) => boolean }): React.ReactElement {
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [insecureConfirmed, setInsecureConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const { t } = useI18n();
  const insecureHttp = requiresInsecureHttpConfirmation(address);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    let normalizedAddress: string | null = null;
    try {
      normalizedAddress = normalizeServerAddress(address, { allowInsecureHttp: insecureConfirmed });
    } catch {
      setError(t.server.invalidAddress);
      return;
    }
    const probe = window.openCord?.server;
    if (!probe) {
      setError(t.server.checkUnavailable);
      return;
    }
    setChecking(true);
    let result: Awaited<ReturnType<typeof probe.probe>>;
    try {
      result = await probe.probe(normalizedAddress);
    } catch {
      setError(t.server.unavailable);
      setChecking(false);
      return;
    }
    setChecking(false);
    if (!result.ok) {
      setError(result.code === "incompatible"
        ? t.server.incompatibleProtocol(result.protocolVersion)
        : result.code === "not-opencord" ? t.server.notOpenCord : t.server.unavailable);
      return;
    }
    const id = createId("server");
    const serverName = normalizedAddress ? new URL(normalizedAddress).hostname : t.server.newSpace;
    const added = onAdd({
      id,
      name: serverName,
      address: normalizedAddress,
      accent: "#4d6bfe",
      maxAttachmentBytes: DEFAULT_ATTACHMENT_LIMIT_BYTES,
      screenShareMaxResolution: DEFAULT_SCREEN_SHARE_MAX_RESOLUTION,
      screenShareMaxFrameRate: DEFAULT_SCREEN_SHARE_MAX_FRAME_RATE,
      channels: [
        { id: `${id}-general`, serverId: id, name: t.server.generalChannel, kind: "text", description: t.server.generalDescription, participantLimit: null, slowmodeSeconds: 0 },
        { id: `${id}-voice`, serverId: id, name: t.server.voiceChannel, kind: "voice", description: t.server.voiceDescription, participantLimit: 25, slowmodeSeconds: 0 },
      ],
      members: [],
    });
    if (!added) { setAddress(""); setError(""); setInsecureConfirmed(false); onOpenChange(false); return; }
    setAddress(""); setError(""); setInsecureConfirmed(false); onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-500/12 text-violet-300"><Globe2 className="size-5" /></div>
          <DialogTitle>{t.server.connectTitle}</DialogTitle>
          <DialogDescription>{t.server.connectDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <label className="grid gap-2 text-sm font-medium text-slate-300">{t.server.address}<Input value={address} disabled={checking} onChange={(event) => { setAddress(event.target.value); setError(""); setInsecureConfirmed(false); }} placeholder={t.server.addressPlaceholder} />{error && <span role="alert" className="text-xs text-red-300">{error}</span>}</label>
          {insecureHttp && <section className="space-y-3 rounded-2xl border border-red-400/25 bg-red-400/[.07] p-4"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" /><div><h4 className="text-sm font-semibold text-red-200">{t.server.insecureTitle}</h4><p className="mt-1 text-xs leading-5 text-red-200/65">{t.server.insecureWarning}</p></div></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-300/15 bg-black/15 p-3 text-xs text-red-100"><input type="checkbox" checked={insecureConfirmed} onChange={(event) => setInsecureConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-red-500" />{t.server.insecureConfirm}</label></section>}
          <Button type="submit" className="w-full" disabled={checking || (insecureHttp && !insecureConfirmed)}>{checking ? <><LoaderCircle className="size-4 animate-spin" />{t.server.checking}</> : t.server.submitConnect}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
