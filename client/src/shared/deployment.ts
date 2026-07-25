import { z } from "zod";

const hostPattern = /^(?=.{1,253}$)(?:\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|(?:\d{1,3}\.){3}\d{1,3})$/i;
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const usernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/i;
const fingerprintPattern = /^SHA256:[A-Za-z0-9+/]{43}$/;

export const sshTargetSchema = z.object({
  host: z.string().trim().min(1).max(253).regex(hostPattern, "Некорректный адрес VPS"),
  port: z.number().int().min(1).max(65_535),
}).strict();

export const sshHostIdentitySchema = sshTargetSchema.extend({
  algorithm: z.string().min(1).max(64),
  fingerprint: z.string().regex(fingerprintPattern),
}).strict();

export const selectedSshKeySchema = z.object({
  credentialId: z.string().uuid(),
  label: z.string().min(1).max(260),
}).strict();

export const passwordAuthenticationSchema = z.object({
  type: z.literal("password"),
  password: z.string().min(1).max(1_024),
}).strict();

export const keyAuthenticationSchema = z.object({
  type: z.literal("private-key"),
  credentialId: z.string().uuid(),
  passphrase: z.string().max(1_024).optional(),
}).strict();

export const deploymentConnectionSchema = sshTargetSchema.extend({
  username: z.string().trim().regex(usernamePattern, "Некорректное имя пользователя"),
  expectedFingerprint: z.string().regex(fingerprintPattern),
  authentication: z.discriminatedUnion("type", [passwordAuthenticationSchema, keyAuthenticationSchema]),
  sudoPassword: z.string().max(1_024).optional(),
}).strict();

export const deploymentModeSchema = z.enum(["docker", "native"]);

export const savedDeploymentConfigurationSchema = sshTargetSchema.extend({
  username: z.string().trim().regex(usernamePattern, "Некорректное имя пользователя"),
  serverName: z.string().trim().min(2).max(48).regex(/^[^\u0000-\u001f\u007f]+$/u, "Название содержит недопустимые символы"),
  domain: z.string().trim().toLowerCase().regex(domainPattern).optional(),
  email: z.string().trim().email().max(254).optional(),
  mode: deploymentModeSchema,
  authentication: z.enum(["private-key", "password"]),
  keyLabel: z.string().min(1).max(260).optional(),
}).strict().superRefine((configuration, context) => {
  if (configuration.domain && !configuration.email) context.addIssue({ code: "custom", path: ["email"], message: "Для TLS-сертификата нужен email" });
  if (configuration.email && !configuration.domain) context.addIssue({ code: "custom", path: ["domain"], message: "Email используется только вместе с доменом" });
});

export const deploymentRequestSchema = deploymentConnectionSchema.extend({
  ownerPublicKey: z.string().min(40).max(1_000),
  serverName: z.string().trim().min(2).max(48).regex(/^[^\u0000-\u001f\u007f]+$/u, "Название содержит недопустимые символы"),
  domain: z.string().trim().toLowerCase().regex(domainPattern, "Укажите домен, направленный на сервер").optional(),
  email: z.string().trim().email().max(254).optional(),
  mode: deploymentModeSchema,
}).strict().superRefine((request, context) => {
  if (request.domain && !request.email) context.addIssue({ code: "custom", path: ["email"], message: "Для TLS-сертификата нужен email" });
  if (request.email && !request.domain) context.addIssue({ code: "custom", path: ["domain"], message: "Email используется только вместе с доменом" });
});

export const deploymentEnvironmentSchema = z.object({
  osId: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  systemd: z.boolean(),
  dockerCli: z.boolean(),
  dockerCompose: z.boolean(),
  dockerUsable: z.boolean(),
  occupiedPorts: z.array(z.number().int().min(1).max(65_535)).max(3),
  openCordInstalled: z.boolean(),
  supported: z.boolean(),
}).strict();

export const deploymentPhaseSchema = z.enum([
  "connecting",
  "uploading",
  "installing",
  "verifying",
  "completed",
  "failed",
  "cancelled",
]);

export const deploymentProgressSchema = z.object({
  operationId: z.string().uuid(),
  phase: deploymentPhaseSchema,
  level: z.enum(["info", "success", "error"]),
  message: z.string().min(1).max(2_000),
  serverUrl: z.string().url().optional(),
}).strict();

export const deploymentStartResultSchema = z.object({ operationId: z.string().uuid() }).strict();

export type SshTarget = z.infer<typeof sshTargetSchema>;
export type SshHostIdentity = z.infer<typeof sshHostIdentitySchema>;
export type SelectedSshKey = z.infer<typeof selectedSshKeySchema>;
export type DeploymentRequest = z.infer<typeof deploymentRequestSchema>;
export type DeploymentConnection = z.infer<typeof deploymentConnectionSchema>;
export type DeploymentMode = z.infer<typeof deploymentModeSchema>;
export type SavedDeploymentConfiguration = z.infer<typeof savedDeploymentConfigurationSchema>;
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;
export type DeploymentProgress = z.infer<typeof deploymentProgressSchema>;
export type DeploymentStartResult = z.infer<typeof deploymentStartResultSchema>;
