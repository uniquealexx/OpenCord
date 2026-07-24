import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeploymentDialog } from "@/components/deployment-dialog";
import type { DeploymentProgress } from "@/shared/deployment";

describe("DeploymentDialog", () => {
  it("requires host fingerprint confirmation and reports a deployed server", async () => {
    const user = userEvent.setup();
    let progressListener: ((event: DeploymentProgress) => void) | undefined;
    const onDeployed = vi.fn();
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(), save: vi.fn(), reset: vi.fn() },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "A".repeat(64), fingerprint: "owner" })), signChallenge: vi.fn(), reset: vi.fn() },
      deployment: {
        selectPrivateKey: vi.fn(async () => ({ credentialId: "123e4567-e89b-42d3-a456-426614174000", label: "id_ed25519" })),
        releasePrivateKey: vi.fn(),
        inspectHost: vi.fn(async () => ({ host: "203.0.113.10", port: 22, algorithm: "ssh-ed25519", fingerprint: `SHA256:${"A".repeat(43)}` })),
        inspectEnvironment: vi.fn(async () => ({ osId: "ubuntu", osVersion: "24.04", architecture: "x86_64", systemd: true, dockerCli: true, dockerCompose: true, dockerUsable: true, occupiedPorts: [], supported: true })),
        start: vi.fn(async () => ({ operationId: "123e4567-e89b-42d3-a456-426614174001" })),
        cancel: vi.fn(),
        onProgress: vi.fn((listener) => { progressListener = listener; return () => undefined; }),
      },
    };

    render(<DeploymentDialog open onOpenChange={vi.fn()} onDeployed={onDeployed} />);
    await user.clear(screen.getByLabelText("Название сервера"));
    await user.type(screen.getByLabelText("Название сервера"), "Команда OpenCord");
    await user.type(screen.getByLabelText("IP-адрес или имя VPS"), "203.0.113.10");
    await user.type(screen.getByLabelText(/Домен OpenCord/), "chat.example.com");
    await user.type(screen.getByLabelText(/Email для TLS-сертификата/), "admin@example.com");
    await user.click(screen.getByRole("button", { name: "Выбрать приватный ключ" }));
    await user.click(screen.getByRole("button", { name: "Проверить VPS" }));

    expect(await screen.findByText(`SHA256:${"A".repeat(43)}`)).toBeInTheDocument();
    const inspectEnvironmentButton = screen.getByRole("button", { name: "Проверить окружение" });
    expect(inspectEnvironmentButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(inspectEnvironmentButton);
    expect(await screen.findByRole("button", { name: /Установить нативно/ })).toBeEnabled();
    await user.click(await screen.findByRole("button", { name: /Использовать существующий Docker/ }));

    await screen.findByText("Ожидание запуска операции…");
    expect(window.openCord.deployment.start).toHaveBeenCalledWith(expect.objectContaining({ mode: "docker", serverName: "Команда OpenCord" }));
    await act(async () => progressListener?.({
      operationId: "123e4567-e89b-42d3-a456-426614174001",
      phase: "failed",
      level: "error",
      message: "Установщик завершился с кодом 1",
    }));
    expect(screen.getByRole("img", { name: "Развёртывание завершилось с ошибкой" })).toBeInTheDocument();
    expect(screen.queryByText("Развёртывание", { selector: "div.text-sm" })).not.toBeInTheDocument();
    await act(async () => progressListener?.({
      operationId: "123e4567-e89b-42d3-a456-426614174001",
      phase: "completed",
      level: "success",
      message: "OpenCord Server установлен и доступен",
      serverUrl: "https://chat.example.com",
    }));
    expect(onDeployed).toHaveBeenCalledWith("https://chat.example.com", "Команда OpenCord");
    expect(await screen.findByText("Сервер готов и добавлен в OpenCord")).toBeInTheDocument();
  });

  it("requires an explicit warning acknowledgement before deployment without a domain", async () => {
    const user = userEvent.setup();
    const start = vi.fn(async (request: unknown) => { void request; return { operationId: "123e4567-e89b-42d3-a456-426614174001" }; });
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(), save: vi.fn(), reset: vi.fn() },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "A".repeat(64), fingerprint: "owner" })), signChallenge: vi.fn(), reset: vi.fn() },
      deployment: {
        selectPrivateKey: vi.fn(async () => ({ credentialId: "123e4567-e89b-42d3-a456-426614174000", label: "id_ed25519" })),
        releasePrivateKey: vi.fn(),
        inspectHost: vi.fn(async () => ({ host: "localhost", port: 2222, algorithm: "ssh-ed25519", fingerprint: `SHA256:${"A".repeat(43)}` })),
        inspectEnvironment: vi.fn(async () => ({ osId: "ubuntu", osVersion: "24.04", architecture: "x86_64", systemd: true, dockerCli: false, dockerCompose: false, dockerUsable: false, occupiedPorts: [], supported: true })),
        start,
        cancel: vi.fn(),
        onProgress: vi.fn(() => () => undefined),
      },
    };

    render(<DeploymentDialog open onOpenChange={vi.fn()} onDeployed={vi.fn()} />);
    await user.type(screen.getByLabelText("IP-адрес или имя VPS"), "localhost");
    await user.clear(screen.getByLabelText("SSH-порт"));
    await user.type(screen.getByLabelText("SSH-порт"), "2222");
    await user.clear(screen.getByLabelText("SSH-пользователь"));
    await user.type(screen.getByLabelText("SSH-пользователь"), "uniqu");
    expect(screen.getByLabelText(/Email для TLS-сертификата/)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Пароль" }));
    await user.type(screen.getByLabelText("Пароль"), "shared-password");
    await user.click(screen.getByRole("button", { name: "Проверить VPS" }));
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Проверить окружение" }));

    expect(await screen.findByText("Подключение без TLS небезопасно")).toBeInTheDocument();
    const nativeButton = screen.getByRole("button", { name: /Установить нативно/ });
    expect(nativeButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Я понимаю риск/ }));
    expect(nativeButton).toBeEnabled();
    await user.click(nativeButton);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "localhost", port: 2222, mode: "native" }));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ ownerPublicKey: "A".repeat(64) }));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ sudoPassword: "shared-password" }));
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("domain");
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("email");
  });
});
