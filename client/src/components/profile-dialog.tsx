"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ru } from "@/lib/i18n/ru";
import type { LocalProfile } from "@/shared/state";

export function ProfileDialog({ profile, open, onOpenChange, onSave }: { profile: LocalProfile; open: boolean; onOpenChange: (open: boolean) => void; onSave: (profile: LocalProfile) => void }): React.ReactElement {
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { setError(ru.profile.tooLarge); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setAvatar(reader.result); };
    reader.readAsDataURL(file);
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (name.trim().length < 2) return;
    onSave({ ...profile, displayName: name.trim(), bio: bio.trim(), avatar });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ru.profile.title}</DialogTitle><DialogDescription>{ru.profile.description}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-4 rounded-2xl border border-white/7 bg-white/[.025] p-4">
            <Avatar name={name || profile.displayName} image={avatar} size="xl" />
            <div><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} /><Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}><Camera className="size-4" />{ru.profile.upload}</Button>{error && <p className="mt-2 text-xs text-red-300">{error}</p>}</div>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.profile.name}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} /></label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.profile.bio}<Textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} /></label>
          <Button type="submit" className="w-full" disabled={name.trim().length < 2}>{ru.profile.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
