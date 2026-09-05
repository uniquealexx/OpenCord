"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProfileForm } from "@/components/profile-form";
import { useI18n } from "@/lib/i18n";
import type { LocalProfile } from "@/shared/state";

/** Standalone-диалог профиля: та же форма, что и страница «Моя учётная запись» в настройках. */
export function ProfileDialog({ profile, open, onOpenChange, onSave }: { profile: LocalProfile; open: boolean; onOpenChange: (open: boolean) => void; onSave: (profile: LocalProfile) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.profile.title}</DialogTitle><DialogDescription>{t.profile.description}</DialogDescription></DialogHeader>
        <ProfileForm profile={profile} onSave={onSave} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
