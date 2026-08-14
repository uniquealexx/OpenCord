"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleX, Container, FileArchive, HardDrive, KeyRound, LoaderCircle, ServerCog, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { currentDictionary, useI18n } from "@/lib/i18n";
import type { DeploymentConnection, DeploymentEnvironment, DeploymentMode, DeploymentProgress, SavedDeploymentConfiguration, SelectedServerBundle, SelectedSshKey, SshHostIdentity } from "@/shared/deployment";

type Authentication = "private-key" | "password";
type Step = "configuration" | "fingerprint" | "environment" | "progress";

interface DeploymentDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onDeployed(serverUrl: string, serverName: string, configuration: SavedDeploymentConfiguration): void;
  preset?: Partial<SavedDeploymentConfiguration>;
  updateOnly?: boolean;
}

export function DeploymentDialog({ open, onOpenChange, onDeployed, preset, updateOnly = false }: DeploymentDialogProps): React.ReactElement {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("configuration");
  const [host, setHost] = useState(preset?.host ?? "");
  const [serverName, setServerName] = useState(preset?.serverName ?? t.deployment.serverNamePlaceholder);
  const [port, setPort] = useState(String(preset?.port ?? 22));
  const [username, setUsername] = useState(preset?.username ?? "root");
  const [domain, setDomain] = useState(preset?.domain ?? "");
  const [email, setEmail] = useState(preset?.email ?? "");
  const [authentication, setAuthentication] = useState<Authentication>(preset?.authentication ?? "private-key");
  const [password, setPassword] = useState("");
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [sudoPassword, setSudoPassword] = useState("");
  const [selectedKey, setSelectedKey] = useState<SelectedSshKey | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<SelectedServerBundle | null>(null);
  const [identity, setIdentity] = useState<SshHostIdentity | null>(null);
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);
  const [environment, setEnvironment] = useState<DeploymentEnvironment | null>(null);
  const [insecureConfirmed, setInsecureConfirmed] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const operationIdRef = useRef<string | null>(null);
  const deployedRef = useRef(false);
  const serverNameRef = useRef(serverName);
  const onDeployedRef = useRef(onDeployed);
  const deploymentConfigurationRef = useRef<SavedDeploymentConfiguration | null>(null);
  const [progress, setProgress] = useState<DeploymentProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const finalProgress = progress.at(-1);
  const finished = finalProgress?.phase === "completed";
  const failedByError = finalProgress?.phase === "failed";
  const cancelled = finalProgress?.phase === "cancelled";
  const failed = failedByError || cancelled;
  const redeployment = environment?.openCordInstalled ?? false;

  useEffect(() => {
    serverNameRef.current = serverName;
    onDeployedRef.current = onDeployed;
  }, [serverName, onDeployed]);

  useEffect(() => {
    const bridge = window.openCord?.deployment;
    if (!bridge) return;
    return bridge.onProgress((event) => {
      if (event.operationId !== operationIdRef.current) return;
      setProgress((current) => [...current, event]);
      if (event.phase === "completed" && event.serverUrl && !deployedRef.current) {
        deployedRef.current = true;
        setPassword(""); setKeyPassphrase(""); setSudoPassword("");
        const configuration = deploymentConfigurationRef.current;
        if (configuration) onDeployedRef.current(event.serverUrl, serverNameRef.current.trim(), configuration);
      }
    });
  }, []);

  function close(nextOpen: boolean): void {
    if (!nextOpen && operationIdRef.current && !finished && !failed) void window.openCord?.deployment.cancel(operationIdRef.current);
    if (!nextOpen) resetSensitiveState();
    onOpenChange(nextOpen);
  }

  function resetSensitiveState(): void {
    if (selectedKey) void window.openCord?.deployment.releasePrivateKey(selectedKey.credentialId);
    setPassword(""); setKeyPassphrase(""); setSudoPassword(""); setSelectedKey(null);
    setIdentity(null); setFingerprintConfirmed(false); setEnvironment(null); setInsecureConfirmed(false); setProgress([]); setError(""); setBusy(false);
    setStep("configuration"); setOperationId(null); operationIdRef.current = null; deploymentConfigurationRef.current = null; deployedRef.current = false;
  }

  async function chooseKey(): Promise<void> {
    setError("");
    try {
      const key = await window.openCord?.deployment.selectPrivateKey();
      if (key) {
        if (selectedKey) await window.openCord?.deployment.releasePrivateKey(selectedKey.credentialId);
        setSelectedKey(key);
      }
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function chooseBundle(): Promise<void> {
    setError("");
    try {
      const bundle = await window.openCord?.deployment.selectServerBundle();
      if (bundle) setSelectedBundle(bundle);
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function inspect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true); setError(""); setIdentity(null); setFingerprintConfirmed(false);
    try {
      const bridge = window.openCord?.deployment;
      if (!bridge) throw new Error(t.deployment.sshDesktopOnly);
      if (authentication === "private-key" && !selectedKey) throw new Error(t.deployment.choosePrivateKey);
      const inspected = await bridge.inspectHost({ host: host.trim(), port: Number(port) });
      setIdentity(inspected); setStep("fingerprint");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  function connectionPayload(): DeploymentConnection {
    if (!identity) throw new Error(t.deployment.fingerprintFirst);
    const normalizedUsername = username.trim();
    const effectiveSudoPassword = normalizedUsername === "root"
      ? ""
      : sudoPassword || (authentication === "password" ? password : "");
    return {
      host: host.trim(), port: Number(port), username: normalizedUsername, expectedFingerprint: identity.fingerprint,
      authentication: authentication === "password"
        ? { type: "password", password }
        : { type: "private-key", credentialId: selectedKey!.credentialId, ...(keyPassphrase ? { passphrase: keyPassphrase } : {}) },
      ...(effectiveSudoPassword ? { sudoPassword: effectiveSudoPassword } : {}),
    };
  }

  async function inspectEnvironment(): Promise<void> {
    if (!identity || !fingerprintConfirmed) return;
    setBusy(true); setError(""); setEnvironment(null);
    try {
      const bridge = window.openCord?.deployment;
      if (!bridge) throw new Error(t.deployment.sshUnavailable);
      setEnvironment(await bridge.inspectEnvironment(connectionPayload()));
      setStep("environment");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function start(mode: DeploymentMode): Promise<void> {
    if (!identity || !fingerprintConfirmed) return;
    setBusy(true); setError(""); setProgress([]);
    try {
      const bridge = window.openCord?.deployment;
      if (!bridge) throw new Error(t.deployment.sshUnavailable);
      const ownerIdentity = await window.openCord?.identity.getOrCreate();
      if (!ownerIdentity) throw new Error(t.deployment.ownerKeyFailed);
      const secureEndpoint = domain.trim() ? { domain: domain.trim(), email: email.trim() } : {};
      deploymentConfigurationRef.current = {
        host: host.trim(), port: Number(port), username: username.trim(), serverName: serverName.trim(),
        ...secureEndpoint, mode, authentication, ...(authentication === "private-key" && selectedKey ? { keyLabel: selectedKey.label } : {}),
      };
      const result = await bridge.start({ ...connectionPayload(), ...secureEndpoint, ownerPublicKey: ownerIdentity.publicKey, serverName: serverName.trim(), mode });
      operationIdRef.current = result.operationId;
      setOperationId(result.operationId); setStep("progress");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function cancel(): Promise<void> {
    if (operationId) await window.openCord?.deployment.cancel(operationId);
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-violet-500/12 text-violet-300"><ServerCog className="size-5" /></div>
        <DialogTitle>{updateOnly ? t.deployment.updateTitle : redeployment ? t.deployment.redeploymentTitle : t.deployment.title}</DialogTitle>
        <DialogDescription>{updateOnly ? t.deployment.updateDescription : redeployment ? t.deployment.redeploymentWarning : t.deployment.description}</DialogDescription>
      </DialogHeader>

      {step === "configuration" && <form onSubmit={(event) => void inspect(event)} className="space-y-4">
        <Field label={t.deployment.serverName}><Input value={serverName} onChange={(event) => setServerName(event.target.value)} minLength={2} maxLength={48} required placeholder={t.deployment.serverNamePlaceholder} /></Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label={t.deployment.host}><Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="203.0.113.10" required /></Field>
          <Field label={t.deployment.port}><Input value={port} onChange={(event) => setPort(event.target.value)} type="number" min={1} max={65535} required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.deployment.username}><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="root" required /></Field>
          <Field label={t.deployment.domain}><Input value={domain} onChange={(event) => { setDomain(event.target.value); if (!event.target.value.trim()) { setEmail(""); setInsecureConfirmed(false); } }} placeholder="chat.example.com" /></Field>
        </div>
        <Field label={t.deployment.email}><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="admin@example.com" disabled={!domain.trim()} required={Boolean(domain.trim())} /></Field>
        <Field label={t.deployment.authentication}>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1">
            <AuthButton active={authentication === "private-key"} onClick={() => setAuthentication("private-key")}><KeyRound className="size-4" />{t.deployment.privateKey}</AuthButton>
            <AuthButton active={authentication === "password"} onClick={() => setAuthentication("password")}>{t.deployment.password}</AuthButton>
          </div>
        </Field>
        {authentication === "private-key" ? <div className="grid grid-cols-2 gap-3">
          <Field label={t.deployment.privateKey}><Button type="button" variant="secondary" aria-label={t.deployment.chooseKey} onClick={() => void chooseKey()} className="w-full">{selectedKey?.label ?? (preset?.keyLabel ? t.deployment.chooseKeyAgain(preset.keyLabel) : t.deployment.chooseKey)}</Button></Field>
          <Field label={t.deployment.passphrase}><Input value={keyPassphrase} onChange={(event) => setKeyPassphrase(event.target.value)} type="password" autoComplete="off" /></Field>
        </div> : <Field label={t.deployment.password}><Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="off" required /></Field>}
        {username !== "root" && <Field label={t.deployment.sudoPassword}><Input value={sudoPassword} onChange={(event) => setSudoPassword(event.target.value)} type="password" autoComplete="off" /></Field>}
        <Field label={t.deployment.bundle}>
          <span className="grid gap-1.5">
            <Button type="button" variant="secondary" onClick={() => void chooseBundle()} className="w-full">
              <FileArchive className="size-4" />{selectedBundle ? `${selectedBundle.fileName} · ${selectedBundle.version}` : t.deployment.bundleChoose}
            </Button>
            <span className="text-[11px] font-normal text-slate-500">{t.deployment.bundleHint}</span>
          </span>
        </Field>
        <p className="rounded-xl border border-cyan-400/10 bg-cyan-400/5 p-3 text-xs leading-5 text-cyan-100/70">{t.deployment.secrets}</p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Button type="submit" disabled={busy} className="w-full">{busy && <LoaderCircle className="size-4 animate-spin" />}{t.deployment.inspect}</Button>
      </form>}

      {step === "fingerprint" && identity && <div className="space-y-5">
        <section className="rounded-2xl border border-amber-300/15 bg-amber-300/5 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-100"><ShieldCheck className="size-5" />{t.deployment.fingerprintTitle}</div>
          <p className="mb-4 text-xs leading-5 text-amber-100/60">{t.deployment.fingerprintHint}</p>
          <div className="rounded-xl bg-black/30 p-3 font-mono text-xs text-slate-200"><div className="mb-1 text-slate-500">{identity.algorithm}</div><div className="break-all">{identity.fingerprint}</div></div>
        </section>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 p-3 text-sm text-slate-300"><input type="checkbox" checked={fingerprintConfirmed} onChange={(event) => setFingerprintConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-violet-500" />{t.deployment.fingerprintConfirm}</label>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="flex gap-3"><Button variant="secondary" onClick={() => setStep("configuration")} className="flex-1">{t.deployment.back}</Button><Button disabled={!fingerprintConfirmed || busy} onClick={() => void inspectEnvironment()} className="flex-1">{busy && <LoaderCircle className="size-4 animate-spin" />}{t.deployment.inspectEnvironment}</Button></div>
      </div>}

      {step === "environment" && environment && <div className="space-y-4">
        <div><h3 className="text-base font-semibold text-slate-100">{t.deployment.environmentTitle}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{t.deployment.environmentDescription}</p></div>
        <section className="grid grid-cols-2 gap-3 rounded-2xl border border-white/8 bg-black/15 p-4 text-xs">
          <div><div className="mb-1 text-slate-600">{t.deployment.systemSummary}</div><div className="font-medium text-slate-200">{environment.osId} {environment.osVersion} · {environment.architecture}</div></div>
          <div><div className="mb-1 text-slate-600">systemd</div><div className={environment.systemd ? "text-emerald-300" : "text-red-300"}>{environment.systemd ? t.deployment.systemdAvailable : t.deployment.systemdMissing}</div></div>
          <div><div className="mb-1 text-slate-600">Docker</div><div className={environment.dockerUsable ? "text-emerald-300" : "text-amber-300"}>{environment.dockerUsable ? t.deployment.dockerReady : t.deployment.dockerMissing}</div></div>
          <div><div className="mb-1 text-slate-600">{t.deployment.ports}</div><div className={environment.occupiedPorts.length ? "text-amber-300" : "text-emerald-300"}>{environment.occupiedPorts.length ? environment.occupiedPorts.join(", ") : t.deployment.portsFree}</div></div>
        </section>
        {!environment.supported && <ErrorMessage>{t.deployment.environmentUnsupported}</ErrorMessage>}
        {environment.openCordInstalled && <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[.06] p-4 text-xs leading-5 text-amber-100/75"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" /><div><p className="font-semibold text-amber-100">{t.deployment.redeploymentWarning}</p><p className="mt-2">{t.deployment.recreateWarning}</p><code className="mt-2 block select-all overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-red-200">{t.deployment.recreateCommand}</code></div></div></section>}
        {environment.occupiedPorts.length > 0 && <p className="flex items-center gap-2 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-xs text-amber-200"><AlertTriangle className="size-4 shrink-0" />{t.deployment.occupiedPorts}: {environment.occupiedPorts.join(", ")}</p>}
        {!domain.trim() && <section className="space-y-3 rounded-2xl border border-red-400/25 bg-red-400/[.07] p-4"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" /><div><h4 className="text-sm font-semibold text-red-200">{t.deployment.insecureTitle}</h4><p className="mt-1 text-xs leading-5 text-red-200/65">{t.deployment.insecureWarning}</p></div></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-300/15 bg-black/15 p-3 text-xs text-red-100"><input type="checkbox" checked={insecureConfirmed} onChange={(event) => setInsecureConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-red-500" />{t.deployment.insecureConfirm}</label></section>}
        {(!updateOnly || !preset?.mode || preset.mode === "docker") && <button type="button" disabled={!environment.supported || busy || (!domain.trim() && !insecureConfirmed)} onClick={() => void start("docker")} className="flex w-full items-start gap-3 rounded-2xl border border-violet-400/25 bg-violet-400/8 p-4 text-left transition hover:bg-violet-400/12 disabled:opacity-40">
          <Container className="mt-0.5 size-5 shrink-0 text-violet-300" /><span><span className="block text-sm font-semibold text-slate-100">{environment.openCordInstalled ? t.deployment.dockerRedeploy : environment.dockerUsable ? t.deployment.dockerExisting : t.deployment.dockerInstall}<span className="ml-2 rounded bg-violet-400/15 px-1.5 py-0.5 text-[9px] uppercase text-violet-200">{t.deployment.recommended}</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">{t.deployment.dockerHint}</span></span>
        </button>}
        {(!updateOnly || !preset?.mode || preset.mode === "native") && <button type="button" disabled={!environment.supported || busy || (!domain.trim() && !insecureConfirmed)} onClick={() => void start("native")} className="flex w-full items-start gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-4 text-left transition hover:bg-white/[.05] disabled:opacity-40">
          <HardDrive className="mt-0.5 size-5 shrink-0 text-cyan-300" /><span><span className="block text-sm font-semibold text-slate-100">{environment.openCordInstalled ? t.deployment.nativeRedeploy : t.deployment.native}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{t.deployment.nativeHint}</span></span>
        </button>}
        {busy && <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin" />{t.deployment.starting}</p>}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Button variant="secondary" onClick={() => setStep("fingerprint")} disabled={busy} className="w-full">{t.deployment.back}</Button>
      </div>}

      {step === "progress" && <div className="space-y-4">
        <div className={`flex items-center gap-3 rounded-xl border p-3 ${failedByError ? "border-red-400/20 bg-red-400/[.06]" : "border-white/8 bg-black/15"}`}>
          {finished
            ? <CheckCircle2 className="size-5 text-emerald-400" />
            : failedByError
              ? <CircleX role="img" aria-label={redeployment ? t.deployment.redeploymentFailed : t.deployment.failed} className="size-5 text-red-400" />
              : cancelled
                ? <CircleX role="img" aria-label={t.deployment.cancelled} className="size-5 text-amber-300" />
                : <LoaderCircle className="size-5 animate-spin text-violet-300" />}
          <div><div className={`text-sm font-semibold ${failedByError ? "text-red-200" : ""}`}>{finished ? redeployment ? t.deployment.redeploymentDone : t.deployment.done : failedByError ? redeployment ? t.deployment.redeploymentFailed : t.deployment.failed : cancelled ? t.deployment.cancelled : redeployment ? t.deployment.redeploymentProgress : t.deployment.progress}</div><div className="text-xs text-slate-500">{domain || `http://${host}:3210`}</div></div>
        </div>
        <div aria-label={t.deployment.deploymentLog} className="scrollbar-thin h-64 overflow-y-auto rounded-xl bg-[#191b1e] p-3 font-mono text-[11px] leading-5 text-slate-400">
          {progress.length ? progress.map((item, index) => <div key={`${item.phase}-${index}`} className={item.level === "error" ? "text-red-300" : item.level === "success" ? "text-emerald-300" : ""}>[{item.phase}] {item.message}</div>) : <div>{t.deployment.waitingForOperation}</div>}
        </div>
        {finished ? <Button onClick={() => close(false)} className="w-full">{t.deployment.finished}</Button> : failed ? <Button variant="secondary" onClick={() => setStep(environment ? "environment" : "configuration")} className="w-full">{t.deployment.chooseInstallMethod}</Button> : <Button variant="danger" onClick={() => void cancel()} className="w-full">{t.deployment.cancel}</Button>}
      </div>}
    </DialogContent>
  </Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <label className="grid gap-2 text-sm font-medium text-slate-300">{label}{children}</label>;
}

function AuthButton({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }): React.ReactElement {
  return <button type="button" onClick={onClick} className={`flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${active ? "bg-violet-500 text-white" : "text-slate-500 hover:text-slate-200"}`}>{children}</button>;
}

function ErrorMessage({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-300">{children}</p>;
}

function messageOf(reason: unknown): string {
  if (!(reason instanceof Error)) return currentDictionary().common.unknownError;
  return reason.message.replace(/^Error invoking remote method '[^']+': Error: /u, "");
}
