import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBootstrapError, supabase } from "../app/supabase";
import {
  ROOVE_APP_NAME,
  ROOVE_CLIENT_NAME,
  ROOVE_PANEL_NAME,
} from "../app/roove";
import "../styles/Login.css";

import logo from "../assets/roove-logo.svg";

const AUTH_DEBUG = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEBUG === "true";

function maskEmail(value: string | null | undefined): string {
  const email = String(value || "").trim();
  if (!email) return "";
  const [name, domain = ""] = email.split("@");
  if (!domain) return `${email.slice(0, 2)}***`;
  const prefix = name.length <= 2 ? `${name[0] || ""}*` : `${name.slice(0, 2)}***`;
  return `${prefix}@${domain}`;
}

function authLoginDebug(event: string, payload?: Record<string, unknown>) {
  if (!AUTH_DEBUG) return;
  if (payload) {
    console.info(`[auth-login] ${event}`, payload);
    return;
  }
  console.info(`[auth-login] ${event}`);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Erro inesperado no login.";
}

function withEmailHint(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes("email not confirmed") || msg.includes("invalid login credentials")) {
    return `${message} Confira se esse e-mail ja foi cadastrado no Supabase Auth.`;
  }
  if (msg.includes("smtp") || msg.includes("email provider")) {
    return [
      message,
      "No Supabase, confirme se o provider de e-mail esta habilitado e se o SMTP esta configurado.",
    ].join(" ");
  }
  return message;
}

type Props = {
  initialError?: string | null;
  authChecking?: boolean;
  onPasswordLoginSuccess?: (session: Session | null) => Promise<void> | void;
};

export default function Login({
  initialError = null,
  authChecking = false,
  onPasswordLoginSuccess,
}: Props) {
  const authConfigError = getSupabaseBootstrapError();
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!initialError) return;
    authLoginDebug("initial_error.updated", { initialError });
    setErr(initialError);
  }, [initialError]);

  async function onPasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordLoading || authChecking) return;

    if (!supabase || authConfigError) {
      setErr(authConfigError || "Supabase Auth nao esta configurado no frontend.");
      return;
    }

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();
    if (!cleanEmail || !cleanPassword) {
      setErr("Informe e-mail e senha para continuar.");
      return;
    }

    setErr(null);
    setInfo(null);
    setPasswordLoading(true);

    try {
      const existing = await supabase.auth.getSession();
      if (existing.error) {
        authLoginDebug("precheck.getSession.error", {
          message: existing.error.message,
        });
      }

      const existingEmail = existing.data.session?.user?.email || null;
      const switchingUser =
        Boolean(existingEmail) &&
        String(existingEmail).toLowerCase() !== cleanEmail.toLowerCase();

      authLoginDebug("sign_in.attempt", {
        email: maskEmail(cleanEmail),
        hasExistingSession: !!existing.data.session,
        existingSessionEmail: maskEmail(existingEmail),
        switchingUser,
      });

      if (switchingUser) {
        const signOutBeforeSwitch = await supabase.auth.signOut();
        authLoginDebug("sign_in.pre_signout_switch_user", {
          email: maskEmail(cleanEmail),
          ok: !signOutBeforeSwitch.error,
          error: signOutBeforeSwitch.error?.message || null,
        });
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });
      if (error) {
        authLoginDebug("sign_in.error", {
          email: maskEmail(cleanEmail),
          message: error.message,
        });
        throw error;
      }

      authLoginDebug("sign_in.success", {
        email: maskEmail(cleanEmail),
        hasSession: !!data.session,
        userId: data.session?.user?.id || null,
      });

      setInfo("Login realizado com sucesso. Carregando o painel da Roove...");
      await onPasswordLoginSuccess?.(data.session ?? null);
    } catch (error: unknown) {
      const message = withEmailHint(toErrorMessage(error));
      authLoginDebug("sign_in.catch", {
        email: maskEmail(cleanEmail),
        message,
      });
      setErr(message);
    } finally {
      setPasswordLoading(false);
    }
  }

  const authUnavailable = Boolean(authConfigError);
  const inputDisabled = passwordLoading || authChecking || authUnavailable;
  const visibleError = err || authConfigError;

  return (
    <div className="loginPage">
      <div className="loginCard">
        <img src={logo} className="loginLogo" alt={ROOVE_CLIENT_NAME} />

        <div className="loginEyebrow">{ROOVE_PANEL_NAME}</div>
        <h1>{ROOVE_APP_NAME}</h1>
        <p>Acesse o painel exclusivo da Roove com seu usuario criado no Supabase Auth.</p>

        {visibleError ? <div className="loginError">{visibleError}</div> : null}
        {info ? <div className="loginInfo">{info}</div> : null}

        <form onSubmit={onPasswordLogin}>
          <input
            type="email"
            placeholder="voce@roove.com.br"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={inputDisabled}
            required
          />
          <input
            type="password"
            placeholder="Sua senha"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={inputDisabled}
            required
          />
          <button type="submit" disabled={inputDisabled}>
            {authUnavailable
              ? "Configuração pendente"
              : passwordLoading || authChecking
                ? "Entrando..."
                : "Entrar no painel"}
          </button>
        </form>

        <div className="loginHint">
          Usuarios e senhas devem ser provisionados no Supabase Auth antes do primeiro acesso.
        </div>
      </div>
    </div>
  );
}
