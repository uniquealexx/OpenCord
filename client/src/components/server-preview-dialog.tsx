"use client";

import Image from "next/image";
import { LogOut, ServerCog, Settings, Trash2, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import type { MockServer } from "@/shared/state";

export function ServerPreviewDialog({ server, canOpenSettings, canUpdate, canDeleteForAll, canRemoveLocal, open, onOpenChange, onSettings, onUpdate, onLeave, onRemoveLocal, onDeleteForAll }: { server: MockServer; canOpenSettings: boolean; canUpdate: boolean; canDeleteForAll: boolean; canRemoveLocal: boolean; open: boolean; onOpenChange: (open: boolean) => void; onSettings: () => void; onUpdate: () => void; onLeave: () => void; onRemoveLocal: () => void; onDeleteForAll: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-white/10 bg-[#26282c] p-0 sm:max-w-lg">
        <div className="relative -ml-5 -mr-6 -mt-5 mb-12 max-md:-mx-4 max-md:-mt-4">
          <div className="relative h-36 overflow-hidden rounded-t-xl border-b border-white/10 bg-primary/15">
            {server.banner && <Image src={server.banner} alt="" fill unoptimized sizes="512px" className="object-cover" />}
          </div>
          <div className="absolute -bottom-10 left-6">
            <Avatar image={server.avatar} name={server.name} color={server.accent} size="xl" className="ring-4 ring-panel shadow-md" />
          </div>
        </div>
        <DialogHeader>
          <DialogTitle className="text-xl">{server.name}</DialogTitle>
          <DialogDescription>{server.description?.trim() || t.serverPreview.description}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.07] bg-black/15 px-3 py-2.5 text-xs text-slate-400">
          <Users className="size-4 text-violet-300" />
          {t.serverPreview.members(server.members.length)}
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {canOpenSettings && (
            <Button onClick={onSettings} className="sm:col-span-2">
              <Settings className="size-4" />
              {t.serverPreview.openSettings}
            </Button>
          )}
          {canUpdate && server.address && (
            <Button variant="secondary" onClick={onUpdate}>
              <ServerCog className="size-4" />
              {t.server.update}
            </Button>
          )}
          <Button variant="secondary" onClick={onLeave}>
            <LogOut className="size-4" />
            {t.server.leaveConfirm}
          </Button>
        </div>
        {(canDeleteForAll || canRemoveLocal) && (
          <div className="mt-4 border-t border-red-400/10 pt-4">
            {canDeleteForAll && server.address && <button type="button" onClick={onDeleteForAll} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-400/10"><Trash2 className="size-4" />{t.server.deleteForAll}</button>}
            {canRemoveLocal && <button type="button" onClick={onRemoveLocal} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-300/10"><Trash2 className="size-4" />{t.server.removeLocal}</button>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
